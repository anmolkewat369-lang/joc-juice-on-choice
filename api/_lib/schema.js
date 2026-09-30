/**
 * Runtime DDL, executed at most once per cold start.
 *
 * Mirrors `db/schema.sql` plus `db/migrations/002_payment_provider_and_admin.sql`,
 * `db/migrations/003_cod_payment_provider.sql` and
 * `db/migrations/004_delivery_and_notifications.sql` — those files stay the
 * reference for running migrations by hand in the Supabase SQL editor. This
 * copy exists so the API can self-provision on first request during local
 * development and nobody has to open a SQL editor to try ordering. Every
 * statement is idempotent.
 *
 * PRODUCTION MUST SET JOC_AUTO_MIGRATE=false and apply the migrations once
 * through the Supabase SQL editor. The Supabase *transaction* pooler hands the
 * session between backends, so a multi-statement DDL script must never be run
 * through it.
 */

export const ORDERS_TABLE = "joc_orders";

export const AUTO_MIGRATE_SQL = `
create extension if not exists pgcrypto;

create table if not exists joc_orders (
  id                    uuid primary key default gen_random_uuid(),
  order_seq             bigint generated always as identity,
  order_id              text unique,
  idempotency_key       text not null unique,
  access_hash           text not null,
  customer_name         text not null,
  phone                 text not null,
  customer_email        text,
  address               text not null,
  landmark              text not null default '',
  special_instructions  text not null default '',
  delivery_distance_meters integer,
  delivery_radius_km    numeric(6,2),
  delivery_eligible     boolean,
  delivery_outcome      text,
  delivery_checked_at   timestamptz,
  tracking_token        text,
  items                 jsonb not null,
  subtotal              integer not null,
  delivery_charge       integer not null,
  total                 integer not null,
  currency              text not null default 'INR',
  payment_method        text not null check (payment_method in ('COD', 'UPI')),
  payment_status        text not null check (payment_status in ('PENDING', 'PAYMENT_VERIFICATION_REQUIRED', 'PAID', 'FAILED', 'REFUNDED')),
  order_status          text not null check (order_status in ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
  razorpay_order_id     text unique,
  razorpay_payment_id   text,
  razorpay_signature    text,
  payment_method_used   text,
  payment_reference     text,
  payment_provider      text check (payment_provider is null or payment_provider in ('cod', 'manual_upi', 'razorpay')),
  payment_verified_at   timestamptz,
  payment_verified_by   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Upgrade path for a pre-002 / pre-003 / pre-004 database.
--
-- 'create table if not exists' is a no-op when the table already exists, so
-- without this block a database created before a migration would silently keep
-- the old columns and the old 'ONLINE' payment_method — the API would then
-- write UPI rows into a table whose CHECK rejects them. These statements mirror
-- the migrations, in the same deliberate order: add columns, widen the
-- payment_provider CHECK, backfill legacy rows, and only then narrow the
-- payment_method and payment_status CHECKs.
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists payment_reference text;
alter table joc_orders add column if not exists payment_provider text;
alter table joc_orders add column if not exists payment_verified_at timestamptz;
alter table joc_orders add column if not exists payment_verified_by text;

-- Migration 004. Nullable and unconstrained on purpose for the same reason as
-- in the migration: NULL must be able to mean "never verified", so none of these
-- can have a default that would manufacture a verification.
--
-- Column first, constraint second — Postgres will not accept a CHECK that names
-- a column which does not exist yet.
alter table joc_orders add column if not exists customer_email text;
alter table joc_orders add column if not exists delivery_distance_meters integer;
alter table joc_orders add column if not exists delivery_radius_km numeric(6,2);
alter table joc_orders add column if not exists delivery_eligible boolean;
alter table joc_orders add column if not exists delivery_checked_at timestamptz;
alter table joc_orders add column if not exists delivery_outcome text;
alter table joc_orders add column if not exists tracking_token text;

-- ---------------------------------------------------------------------------
-- Widen payment_provider to accept 'cod' FIRST (migration 003).
--
-- This has to happen before the backfill below stamps 'cod' onto cash orders,
-- and it is the one change that *widens* rather than narrows, so it can never
-- reject a row that the previous constraint accepted. The guard reads the
-- catalog rather than scanning the table, so every cold start after the first
-- costs one indexed lookup instead of a full scan under a table lock.
-- ---------------------------------------------------------------------------
do $$
declare
  current_clause text;
begin
  select c.check_clause into current_clause
    from information_schema.check_constraints c
    join information_schema.table_constraints t
      on t.constraint_name = c.constraint_name
     and t.constraint_schema = c.constraint_schema
   where t.table_name = 'joc_orders'
     and t.constraint_name = 'joc_orders_payment_provider_check';

  if current_clause is null or current_clause not like '%cod%' then
    alter table joc_orders drop constraint if exists joc_orders_payment_provider_check;
    alter table joc_orders add constraint joc_orders_payment_provider_check
      check (payment_provider is null or payment_provider in ('cod', 'manual_upi', 'razorpay'));
  end if;
end $$;

update joc_orders
   set payment_method   = 'UPI',
       payment_provider = case
                           when razorpay_order_id is not null then 'razorpay'
                           else 'manual_upi'
                         end
 where payment_method = 'ONLINE';

update joc_orders
   set payment_provider = 'manual_upi'
 where payment_method = 'UPI' and payment_provider is null;

-- A cash order is recorded as provider 'cod' so every order carries a provider
-- rather than a null. Backfilling history keeps the admin dashboard, which
-- prints payment_provider, honest about older rows.
update joc_orders
   set payment_provider = 'cod'
 where payment_method = 'COD'
   and (payment_provider is null or payment_provider <> 'cod');

update joc_orders
   set payment_verified_at = coalesce(payment_verified_at, updated_at)
 where payment_status = 'PAID' and payment_verified_at is null;

-- Narrow each CHECK exactly once.
--
-- The guard on each block is "is the constraint already defined with the new
-- values?", read from the catalog. That keeps every cold start after the first
-- to a cheap catalog read instead of a full table scan under an ACCESS EXCLUSIVE
-- lock, and it skips rather than aborts if legacy data would not satisfy the new
-- CHECK — the manual migration raises a specific error in that case.
do $$
declare
  current_clause text;
begin
  select c.check_clause into current_clause
    from information_schema.check_constraints c
    join information_schema.table_constraints t
      on t.constraint_name = c.constraint_name
     and t.constraint_schema = c.constraint_schema
   where t.table_name = 'joc_orders'
     and t.constraint_name = 'joc_orders_payment_method_check';

  if current_clause is null or current_clause not like '%UPI%' then
    if not exists (select 1 from joc_orders where payment_method not in ('COD', 'UPI')) then
      alter table joc_orders drop constraint if exists joc_orders_payment_method_check;
      alter table joc_orders add constraint joc_orders_payment_method_check
        check (payment_method in ('COD', 'UPI'));
    end if;
  end if;

  select c.check_clause into current_clause
    from information_schema.check_constraints c
    join information_schema.table_constraints t
      on t.constraint_name = c.constraint_name
     and t.constraint_schema = c.constraint_schema
   where t.table_name = 'joc_orders'
     and t.constraint_name = 'joc_orders_payment_status_check';

  if current_clause is null or current_clause not like '%VERIFICATION%' then
    if not exists (select 1 from joc_orders
                    where payment_status not in
                      ('PENDING', 'PAYMENT_VERIFICATION_REQUIRED', 'PAID', 'FAILED', 'REFUNDED')) then
      alter table joc_orders drop constraint if exists joc_orders_payment_status_check;
      alter table joc_orders add constraint joc_orders_payment_status_check
        check (payment_status in (
          'PENDING', 'PAYMENT_VERIFICATION_REQUIRED', 'PAID', 'FAILED', 'REFUNDED'));
    end if;
  end if;
end $$;

create table if not exists joc_order_events (  id           bigint generated always as identity primary key,
  order_uuid   uuid not null references joc_orders (id) on delete cascade,
  order_ref    text not null,
  event_type   text not null
                 check (event_type in (
                   'ORDER_CREATED', 'STATUS_CHANGED', 'PAYMENT_REFERENCE_SUBMITTED',
                   'PAYMENT_STATUS_CHANGED', 'PAYMENT_METHOD_CHANGED',
                   'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'NOTE'
                 )),
  field        text,
  old_value    text,
  new_value    text,
  actor        text not null default 'system',
  note         text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists joc_orders_created_at_idx on joc_orders (created_at desc);
create index if not exists joc_orders_status_idx on joc_orders (order_status, created_at desc);
create index if not exists joc_orders_payment_idx on joc_orders (payment_status, created_at desc);
create index if not exists joc_orders_payment_provider_idx on joc_orders (payment_provider);
create index if not exists joc_orders_payment_reference_idx on joc_orders (payment_reference) where payment_reference is not null;
create index if not exists joc_orders_phone_idx on joc_orders (phone);
create index if not exists joc_orders_customer_email_idx on joc_orders (customer_email) where customer_email is not null;
create index if not exists joc_order_events_order_idx on joc_order_events (order_uuid, created_at desc);
create index if not exists joc_order_events_created_at_idx on joc_order_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Notification ledger (migration 004).
--
-- The unique constraint is the exactly-once mechanism, so it is part of the
-- table definition here rather than a separate statement: there is no window in
-- which the table exists without it, and therefore no window in which two
-- instances could both believe they own a send.
-- ---------------------------------------------------------------------------
create table if not exists joc_notifications (
  id                bigint generated always as identity primary key,
  order_uuid        uuid not null references joc_orders (id) on delete cascade,
  order_ref         text not null,
  notification_type text not null
                      check (notification_type in (
                        'admin_new_order', 'customer_order_received',
                        'customer_status', 'customer_payment_verified'
                      )),
  dedupe_key        text not null,
  recipient         text not null,
  provider          text not null default 'resend',
  status            text not null default 'pending'
                      check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts          integer not null default 0,
  last_error        text,
  lease_until       timestamptz not null default now(),
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint joc_notifications_once unique (order_uuid, notification_type, dedupe_key)
);

create index if not exists joc_notifications_order_idx
  on joc_notifications (order_uuid, created_at desc);
create index if not exists joc_notifications_pending_idx
  on joc_notifications (lease_until) where status = 'pending';

create or replace function joc_touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists joc_orders_touch on joc_orders;
create trigger joc_orders_touch
  before update on joc_orders
  for each row execute function joc_touch_updated_at();

alter table joc_orders enable row level security;
alter table joc_order_events enable row level security;
alter table joc_notifications enable row level security;

create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);
insert into joc_schema_migrations (version) values ('002_payment_provider_and_admin')
  on conflict (version) do nothing;
insert into joc_schema_migrations (version) values ('003_cod_payment_provider')
  on conflict (version) do nothing;
insert into joc_schema_migrations (version) values ('004_delivery_and_notifications')
  on conflict (version) do nothing;
`;

