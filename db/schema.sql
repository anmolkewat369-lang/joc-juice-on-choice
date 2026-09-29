-- ===========================================================================
-- JOC — Juice On Choice | Order store
--
-- Target: Supabase Postgres (or any Postgres). Run once in the Supabase SQL
-- editor, or via `psql "$DATABASE_URL" -f db/schema.sql`.
--
-- This is the CURRENT shape, as of migration 003. It is safe to run on a fresh
-- database. On an existing database, run the migrations in db/migrations/
-- instead — they are additive and preserve your data, whereas this file's
-- `create table if not exists` would leave an older table's columns and CHECK
-- constraints untouched.
--
-- Design notes
--   * `id`          internal UUID primary key — never shown to the customer.
--   * `order_id`    human-readable reference, e.g. JOC-20260928-0001.
--   * `order_seq`   DB-generated identity, the collision-free source of the
--                   numeric suffix. Not a timestamp, so it cannot collide.
--   * `idempotency_key` unique — makes a repeated "Place Order" (double click,
--                   refresh, network retry) return the original order instead of
--                   creating a second one.
--   * `access_hash` SHA-256 of a per-order secret. The customer proves they own
--                   the order with the secret; the address and phone are never
--                   exposed to someone who only guesses an order id.
--   * `payment_method` is what the customer chose (COD / UPI).
--                   `payment_provider` is which rail settles it: `cod` for cash
--                   on delivery, `manual_upi` or `razorpay` for a digital
--                   payment. Keeping them apart means switching rails later does
--                   not require rewriting what the customer picked.
--   * `payment_status` reaching PAID is only ever written by a verified gateway
--                   signature or an authenticated admin. A customer-submitted UTR
--                   can only ever produce PAYMENT_VERIFICATION_REQUIRED.
--   * No card data, no CVV, no gateway secrets are stored here.
-- ===========================================================================

create extension if not exists pgcrypto;

create table if not exists joc_orders (
  id                  uuid primary key default gen_random_uuid(),
  order_seq           bigint generated always as identity,
  order_id            text unique,
  idempotency_key     text not null unique,
  access_hash         text not null,

  -- Customer & delivery. Only what checkout actually collects.
  customer_name       text not null,
  phone               text not null,
  address             text not null,
  landmark            text not null default '',
  special_instructions text not null default '',

  -- Items are stored as jsonb: [{ id, name, price, qty, lineTotal }]
  -- with name/price snapshotted from the trusted menu at order time so historic
  -- orders stay readable after the menu is re-priced.
  items               jsonb not null,
  subtotal            integer not null,
  delivery_charge     integer not null,
  total               integer not null,
  currency            text not null default 'INR',

  -- Status model (foundation for a future JOC admin panel).
  payment_method      text not null check (payment_method in ('COD', 'UPI')),
  payment_status      text not null
                        check (payment_status in (
                          'PENDING', 'PAYMENT_VERIFICATION_REQUIRED',
                          'PAID', 'FAILED', 'REFUNDED'
                        )),
  order_status        text not null
                        check (order_status in (
                          'RECEIVED', 'CONFIRMED', 'PREPARING', 'READY',
                          'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
                        )),

  -- Which rail settles the payment. 'cod' for cash on delivery;
  -- 'manual_upi' or 'razorpay' for a digital payment.
  payment_provider    text
                        check (payment_provider is null or payment_provider in
                          ('cod', 'manual_upi', 'razorpay')),

  -- The UTR the customer submitted after paying by UPI. A claim, never proof.
  payment_reference   text,
  -- Set by the server, and only when an authenticated admin verified the UTR.
  payment_verified_at timestamptz,
  payment_verified_by text,

  -- Gateway references. Null for cash on delivery.
  razorpay_order_id   text unique,
  razorpay_payment_id text,
  razorpay_signature  text,
  payment_method_used text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Admin panel will list newest first, filtered by lifecycle state.
create index if not exists joc_orders_created_at_idx on joc_orders (created_at desc);
create index if not exists joc_orders_status_idx on joc_orders (order_status, created_at desc);
create index if not exists joc_orders_payment_idx on joc_orders (payment_status, created_at desc);
create index if not exists joc_orders_payment_provider_idx on joc_orders (payment_provider);
create index if not exists joc_orders_payment_reference_idx
  on joc_orders (payment_reference) where payment_reference is not null;
create index if not exists joc_orders_phone_idx on joc_orders (phone);

-- ---------------------------------------------------------------------------
-- Order event log — an append-only audit trail of every state change.
-- ---------------------------------------------------------------------------
create table if not exists joc_order_events (
  id           bigint generated always as identity primary key,
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

create index if not exists joc_order_events_order_idx
  on joc_order_events (order_uuid, created_at desc);
create index if not exists joc_order_events_created_at_idx
  on joc_order_events (created_at desc);

-- ---------------------------------------------------------------------
-- Keeps updated_at honest without the application remembering to do it.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- The API connects with the service-role / pooler credentials and talks to
-- this table only from the server. There is no client-side Supabase SDK, so
-- no policies are granted to `anon` or `authenticated`. Enabling RLS with no
-- policies means any accidental direct PostgREST read returns nothing.
-- ---------------------------------------------------------------------
alter table joc_orders enable row level security;
alter table joc_order_events enable row level security;
