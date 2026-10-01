-- ===========================================================================
-- JOC — Juice On Choice | Migration 006
-- Customer accounts, order ownership, and Web Push subscriptions
--
-- Target : Supabase Postgres (project hebviqzbqpukjvyuqrxu)
-- Run it : ONCE, in the Supabase SQL editor
--          Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run this through the Supabase *transaction* pooler. Transaction pooling
-- is the right choice for the serverless runtime, but not for a multi-statement
-- DDL script: the session is handed between backends, so session state cannot be
-- relied upon. The SQL editor connects directly.
--
-- WHY
--   1. ORDER OWNERSHIP. A customer who logs in can see their own orders under My
--      Orders. That requires the order to carry the Supabase user id it belongs
--      to. The id is ALWAYS derived server-side from a validated session and
--      written here; a browser never sends it.
--
--      Nullable on purpose. Every order placed before accounts existed — and any
--      anonymous order the API still accepts — has NULL, which means "not
--      attached to an account". That is a different fact from "owned by nobody",
--      and it is what makes this migration safe to run before, during or after a
--      deploy.
--
--      There is deliberately NO foreign key to auth.users: deleting a Supabase
--      user must not be blocked by, or cascade into, their order history. Order
--      rows are business records, not profile data. The application only ever
--      writes an id that Supabase just authenticated.
--
--   2. WEB PUSH. Real push needs somewhere to store each browser subscription
--      and a record of which notifications have already been delivered, so a
--      retried admin action or a second serverless instance cannot send twice.
--      Two additive tables cover that:
--
--        joc_push_subscriptions  one row per browser endpoint, tied to the
--                                authenticated user id and role the server
--                                derived — never a role the browser sent.
--        joc_push_deliveries     the per-(order, event, subscription) ledger.
--                                The UNIQUE constraint is the exactly-once
--                                mechanism, exactly as joc_notifications is for
--                                email.
--
-- WHAT IS NOT TOUCHED
--   Payments, payment references, UTR verification, order events and the
--   existing notification ledger are all left exactly as they are. This
--   migration adds columns and tables only. No DROP, no DELETE, no rewrite.
--
-- Properties
--   * Additive. Existing orders and their NULL customer_user_id are preserved.
--   * Idempotent. Safe to run twice.
--   * Row Level Security enabled with no policies on the new tables, matching
--     the rest. The server connects with DATABASE_URL; the browser never does.
--
-- ORDERING
--   Deploy this migration BEFORE, or at the same moment as, the code change
--   that writes customer_user_id and the push tables.
--
--   If you deploy with JOC_AUTO_MIGRATE=true, api/_lib/schema.js applies this
--   same change on the first request and the manual run is unnecessary. After
--   running it, keep JOC_AUTO_MIGRATE=false so the API never executes DDL at
--   runtime.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The owning customer
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists customer_user_id uuid;

comment on column joc_orders.customer_user_id is
  'Supabase Auth user id this order belongs to, derived server-side from a validated session. NULL = anonymous/legacy order. No FK on purpose: user deletion must not affect order history.';

create index if not exists joc_orders_customer_user_idx
  on joc_orders (customer_user_id, created_at desc)
  where customer_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Push subscriptions
--
-- endpoint is UNIQUE across the whole table. A browser gets one subscription per
-- service worker; if the same browser logs in as a different user (or as an
-- admin after a customer), the row is reassigned by upsert rather than
-- duplicated. That is why the upsert key is the endpoint, not (user_id, role).
-- ---------------------------------------------------------------------------
create table if not exists joc_push_subscriptions (
  id           bigint generated always as identity primary key,
  user_id      text not null,
  role         text not null check (role in ('customer', 'admin')),
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz,
  constraint joc_push_subscriptions_endpoint unique (endpoint)
);

create index if not exists joc_push_subscriptions_owner_idx
  on joc_push_subscriptions (role, user_id);

comment on table joc_push_subscriptions is
  'One Web Push subscription per browser endpoint. user_id and role are always derived server-side from a validated session, never accepted from the browser.';

-- ---------------------------------------------------------------------------
-- 3. The push delivery ledger
--
-- The UNIQUE (order_uuid, event, subscription_id) is the exactly-once
-- mechanism: a second concurrent claim of the same send conflicts and loses, so
-- only one caller proceeds. `event` is a stable string such as
-- 'admin_new_order' or 'customer_order_confirmed'.
--
-- A permanent failure (HTTP 404/410 from the push service) is recorded as
-- 'failed' and the subscription is removed, rather than retried forever.
-- ---------------------------------------------------------------------------
create table if not exists joc_push_deliveries (
  id              bigint generated always as identity primary key,
  order_uuid      uuid not null references joc_orders (id) on delete cascade,
  order_ref       text not null,
  event           text not null,
  subscription_id bigint not null references joc_push_subscriptions (id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint joc_push_deliveries_once unique (order_uuid, event, subscription_id)
);

create index if not exists joc_push_deliveries_order_idx
  on joc_push_deliveries (order_uuid, created_at desc);

comment on table joc_push_deliveries is
  'Per-(order, event, subscription) push send ledger. The unique constraint is what makes a repeated status change unable to send the same push twice.';

alter table joc_push_subscriptions enable row level security;
alter table joc_push_deliveries enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Roll-forward marker
-- ---------------------------------------------------------------------------
create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

insert into joc_schema_migrations (version) values ('006_customer_accounts')
  on conflict (version) do nothing;

commit;
