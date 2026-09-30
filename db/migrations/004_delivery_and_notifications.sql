-- ===========================================================================
-- JOC — Juice On Choice | Migration 004
-- Delivery verification, customer email, and an idempotent notification ledger
--
-- Target : Supabase Postgres (project hebviqzbqpukjvyuqrxu)
-- Run it : ONCE, in the Supabase SQL editor
--          Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run this through the Supabase *transaction* pooler
-- (aws-0-ap-southeast-1.pooler.supabase.com:6543). Transaction pooling is the
-- right choice for the serverless runtime, but not for a multi-statement DDL
-- script: the session is handed between backends, so session state such as
-- search_path and advisory locks cannot be relied upon. The SQL editor connects
-- directly.
--
-- WHY
--   Three separate gaps, one migration.
--
--   1. DELIVERY PROOF. JOC only delivers within a fixed DRIVING distance of the
--      store. Once POST /api/orders started refusing addresses it could not
--      verify, an order row no longer carried any record that the address had
--      been checked at all. When an admin later asks "did this one get checked,
--      and how far was it?", there was nothing to answer with — and a row with
--      NULLs is indistinguishable from a row written before the rule existed.
--      So the verified distance, the radius it was compared against, and the
--      outcome are all recorded. Older rows are left NULL on purpose: they were
--      genuinely never verified, and the admin view says so rather than guessing.
--
--   2. CUSTOMER EMAIL. Optional. Used for order updates and a secure tracking
--      link. Blank is a normal, valid value — a customer who gives no address
--      orders exactly as before — so the column is nullable and unconstrained
--      beyond length. The application validates the shape; the database does not
--      need a CHECK to enforce something only the server can verify anyway.
--
--   3. NOTIFICATION LEDGER. Emails must not be duplicated by a retried request,
--      a second serverless instance, an admin page refresh, or a replayed
--      idempotency key — and a notification must never be able to fail an order.
--      This table is the idempotency record. The UNIQUE constraint is the whole
--      mechanism: a concurrent second insert of the same (order, type, key)
--      conflicts and loses, so only one caller ever proceeds to send.
--
--   4. TRACKING TOKEN. The customer-facing tracking link needs the per-order
--      secret, but `access_hash` is a one-way hash — it cannot be turned back
--      into a link after the customer closes the tab. `tracking_token` therefore
--      stores the secret itself in a column of its own, used only to compose
--      notification links. It is NOT an authorisation path: every lookup still
--      authenticates against access_hash via the existing constant-time
--      comparison. No API route returns this column, and no admin view shows it.
--
-- Properties
--   * Additive. No DROP, no DELETE, no rewrite of existing rows.
--   * Idempotent. Safe to run twice.
--   * Existing orders, payments, events and admin users are preserved untouched.
--   * Row Level Security is left enabled with no policies, matching the rest.
--
-- ORDERING — IMPORTANT
--   The new code writes customer_email, the delivery_* columns and
--   tracking_token. Deploy this migration BEFORE, or at the same moment as, the
--   code change, or order creation will fail on unknown columns.
--
--   If you deploy with JOC_AUTO_MIGRATE=true, api/_lib/schema.js applies this
--   same change on the first request and the manual run is unnecessary.
--
--   After running this, keep JOC_AUTO_MIGRATE=false so the API never executes DDL
--   at runtime.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Optional customer email
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists customer_email text;

comment on column joc_orders.customer_email is
  'Optional. Used only for order updates and the tracking link. NULL is a normal, valid value.';

-- ---------------------------------------------------------------------------
-- 2. The delivery verification record
--
-- delivery_outcome mirrors DELIVERY_OUTCOME in shared/delivery.js. The CHECK
-- lists the outcomes that can reach the database at all; an order is only ever
-- written with 'AVAILABLE', because every other outcome is refused before the
-- insert. The other values are permitted so the constraint documents the real
-- contract and so a future manual import cannot smuggle in an unlisted string.
--
-- delivery_eligible is NOT DEFAULT true on purpose. A default of true would make
-- every row written before this migration — and every row written by any future
-- insert that forgot the columns — claim a verification that never happened.
-- NULL means "not verified", which is the truthful reading for history.
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists delivery_distance_meters integer;
alter table joc_orders add column if not exists delivery_radius_km numeric(6,2);
alter table joc_orders add column if not exists delivery_eligible boolean;
alter table joc_orders add column if not exists delivery_checked_at timestamptz;
alter table joc_orders add column if not exists delivery_outcome text;

-- The column has to exist before the constraint that references it.
do $$
begin
  alter table joc_orders drop constraint if exists joc_orders_delivery_outcome_check;
  alter table joc_orders add constraint joc_orders_delivery_outcome_check
    check (delivery_outcome is null or delivery_outcome in (
      'AVAILABLE', 'OUT_OF_RANGE', 'ADDRESS_NOT_FOUND', 'ADDRESS_AMBIGUOUS',
      'CHECK_UNAVAILABLE', 'NOT_CONFIGURED'
    ));
end $$;

comment on column joc_orders.delivery_distance_meters is
  'Measured DRIVING distance from the store in whole metres, as returned by the Google Routes API. NULL = never verified.';
comment on column joc_orders.delivery_radius_km is
  'The radius the distance was compared against, recorded so a later rule change cannot silently reinterpret an old order.';
comment on column joc_orders.delivery_eligible is
  'True only when the server verified the address was inside the radius. NULL on pre-004 orders.';
comment on column joc_orders.delivery_outcome is
  'DELIVERY_OUTCOME from shared/delivery.js. Stored orders always carry AVAILABLE.';
comment on column joc_orders.delivery_checked_at is
  'When the server performed the check. NULL = never verified.';

-- ---------------------------------------------------------------------------
-- 3. The per-order secret, kept for composing tracking links only
--
-- This is the one new column that stores a bearer secret in plaintext, and it
-- is worth being explicit about why that is acceptable here and nowhere else.
--
-- `access_hash` stays the single authorisation path: every customer lookup
-- hashes the supplied token and compares it in constant time. `tracking_token`
-- exists for a different and much weaker job — an emailed link has to contain
-- the secret, hours later, in a process that has no copy of the plaintext. A
-- hash cannot do that job, so either the plaintext is kept or the emailed link
-- cannot exist.
--
-- The column is therefore:
--   * never selected by any customer-facing query (see toCamel / toPublicOrder);
--   * never selected by any admin-facing query or view;
--   * never logged, never returned in an API response, never included in an
--     order event's metadata;
--   * rotatable in the future by regenerating it, which invalidates every
--     previously emailed tracking link at once — a deliberate, cheap revocation.
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists tracking_token text;

comment on column joc_orders.tracking_token is
  'Plaintext per-order secret, used ONLY to build tracking links in notification emails. NOT an authorisation path (access_hash is) and never returned by any API.';

-- ---------------------------------------------------------------------------
-- 4. The notification ledger
--
-- The UNIQUE (order_uuid, notification_type, dedupe_key) is what makes a
-- notification happen exactly once, atomically, across every serverless
-- instance. The send is claimed by inserting; a second concurrent claim of the
-- same key conflicts and does nothing, so the loser of the race never sends.
--
--   notification_type  which lifecycle moment: admin_new_order,
--                      customer_status, customer_payment_verified, ...
--   dedupe_key         the *value* that makes this notification distinct within
--                      its type. A status change dedupes on the new status
--                      ('PREPARING'), so re-saving the same status is a no-op
--                      while a real change is new. A one-shot like the new-order
--                      alert dedupes on a constant.
--   status             pending (claimed, not yet resolved) -> sent | failed.
--                      'skipped' records a deliberate decision not to send, e.g.
--                      the customer supplied no email address.
--   attempts           bounded. A retry after a transport failure is allowed; a
--                      runaway loop is not.
--   lease_until        a claimed row that never resolves (instance killed mid
--                      send) is reclaimable once this passes, so a crash cannot
--                      silently swallow a notification forever.
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

comment on table joc_notifications is
  'One row per notification that may have been sent. The unique constraint is the exactly-once mechanism; a send is never allowed to affect whether an order succeeds.';

-- ---------------------------------------------------------------------------
-- 5. Roll-forward marker
-- ---------------------------------------------------------------------------
create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

insert into joc_schema_migrations (version) values ('004_delivery_and_notifications')
  on conflict (version) do nothing;

commit;
