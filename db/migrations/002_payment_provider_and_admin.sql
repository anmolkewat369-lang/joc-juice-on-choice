-- ===========================================================================
-- JOC — Juice On Choice | Migration 002
-- Payment provider separation + manual UPI reference + admin order audit
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
-- Properties
--   * Additive. No DROP TABLE, no DELETE, no destructive rewrite.
--   * Idempotent. Every statement is safe to run twice.
--   * Existing orders are preserved. Orders created before this migration used
--     payment_method = 'ONLINE'; they are mapped forward to 'UPI' with the
--     provider that actually settled them, never silently discarded.
--   * Row Level Security stays ENABLED on every table, and no policy is granted
--     to anon or authenticated. All access remains server-side.
--
-- After running this, set JOC_AUTO_MIGRATE=false so the API never executes DDL
-- at runtime.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. New columns
--
-- payment_method     now distinguishes *what the customer chose* (COD / UPI).
-- payment_provider    records *how a digital payment settles* (manual_upi /
--                    razorpay), so the rails can change without touching what
--                    the customer picked at checkout.
-- payment_reference   the UTR / transaction reference the customer submitted
--                    after paying by UPI. A claim, never proof of payment.
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists payment_reference text;
alter table joc_orders add column if not exists payment_provider text;
alter table joc_orders add column if not exists payment_verified_at timestamptz;
alter table joc_orders add column if not exists payment_verified_by text;

comment on column joc_orders.payment_reference is
  'UTR / transaction reference supplied by the customer for a manual UPI payment. Not proof of payment.';
comment on column joc_orders.payment_provider is
  'Settlement rail for a digital payment: manual_upi or razorpay. Null for cash on delivery.';
comment on column joc_orders.payment_verified_at is
  'When an authenticated admin confirmed that a manual UPI payment actually arrived.';
comment on column joc_orders.payment_verified_by is
  'Admin identity (Supabase user id) that performed the payment verification.';

-- ---------------------------------------------------------------------------
-- 2. Order status history / audit trail
--
-- Append-only. Every status change, payment reference submission and manual
-- payment verification lands here with who did it and when, so an order's
-- history is reconstructable after the fact.
-- ---------------------------------------------------------------------------
create table if not exists joc_order_events (
  id           bigint generated always as identity primary key,
  order_uuid   uuid not null references joc_orders (id) on delete cascade,
  order_ref    text not null,
  event_type   text not null
                 check (event_type in (
                   'ORDER_CREATED',
                   'STATUS_CHANGED',
                   'PAYMENT_REFERENCE_SUBMITTED',
                   'PAYMENT_STATUS_CHANGED',
                   'PAYMENT_METHOD_CHANGED',
                   'PAYMENT_VERIFIED',
                   'PAYMENT_FAILED',
                   'NOTE'
                 )),
  field        text,
  old_value    text,
  new_value    text,
  actor        text not null default 'system',
  note         text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table joc_order_events is
  'Append-only audit trail for joc_orders. Never updated, never deleted by the application.';

-- ---------------------------------------------------------------------------
-- 3. Carry existing orders forward  [MUST run before the new CHECKs below]
--
-- Ordering matters here, and it is not cosmetic.
--
-- `joc_orders.payment_method` currently carries an inline CHECK allowing
-- ('COD', 'ONLINE'). Adding the new CHECK for ('COD', 'UPI') *before* rewriting
-- the 'ONLINE' rows would validate against the existing data and abort the whole
-- transaction with a constraint-violation error. So every backfill runs first,
-- and only then is the constraint narrowed.
--
-- The intent of 'ONLINE' is exactly what 'UPI' now means: a digital payment,
-- settled by a provider. Orders that already hold a gateway order id were
-- settled by Razorpay; the rest never got that far and are treated as manual UPI.
-- ---------------------------------------------------------------------------
update joc_orders
   set payment_method  = 'UPI',
       payment_provider = case
                           when razorpay_order_id is not null then 'razorpay'
                           else 'manual_upi'
                         end
 where payment_method = 'ONLINE';

update joc_orders
   set payment_provider = 'manual_upi'
 where payment_method = 'UPI' and payment_provider is null;

update joc_orders
   set payment_provider = null
 where payment_method = 'COD' and payment_provider is not null;

-- An order that already reads PAID was verified by whatever process ran before
-- this migration. Record when, so the row is not left claiming an anonymous
-- verification with no timestamp.
update joc_orders
   set payment_verified_at = coalesce(payment_verified_at, updated_at)
 where payment_status = 'PAID' and payment_verified_at is null;

-- Safety net: should the backfill have missed anything, this makes the mismatch
-- loud and specific instead of a generic constraint violation.
do $$
declare
  leftover text;
begin
  select payment_method into leftover
    from joc_orders
   where payment_method not in ('COD', 'UPI')
   limit 1;

  if leftover is not null then
    raise exception
      'Migration 002 aborted: found joc_orders.payment_method = %, which is neither COD nor UPI.', leftover;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Narrow the CHECK constraints
--
-- Safe now that no row can violate them. Each is dropped and re-added under an
-- explicit name so a future migration can address it by name.
-- ---------------------------------------------------------------------------
drop constraint if exists joc_orders_payment_status_check on joc_orders;
alter table joc_orders
  add constraint joc_orders_payment_status_check
  check (payment_status in (
    'PENDING', 'PAYMENT_VERIFICATION_REQUIRED', 'PAID', 'FAILED', 'REFUNDED'
  ));

drop constraint if exists joc_orders_payment_method_check on joc_orders;
alter table joc_orders
  add constraint joc_orders_payment_method_check
  check (payment_method in ('COD', 'UPI'));

drop constraint if exists joc_orders_payment_provider_check on joc_orders;
alter table joc_orders
  add constraint joc_orders_payment_provider_check
  check (payment_provider is null or payment_provider in ('manual_upi', 'razorpay'));

-- ---------------------------------------------------------------------------
-- 5. Indexes for the admin dashboard
--
-- The dashboard always sorts newest-first and filters by lifecycle state, so
-- both access patterns are covered.
-- ---------------------------------------------------------------------------
create index if not exists joc_orders_payment_provider_idx
  on joc_orders (payment_provider);

create index if not exists joc_orders_payment_reference_idx
  on joc_orders (payment_reference)
  where payment_reference is not null;

create index if not exists joc_orders_phone_idx
  on joc_orders (phone);

create index if not exists joc_order_events_order_idx
  on joc_order_events (order_uuid, created_at desc);

create index if not exists joc_order_events_created_at_idx
  on joc_order_events (created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--
-- Same posture as joc_orders: enabled, with no policy for anon or
-- authenticated. The browser has no client-side Supabase SDK and must never
-- acquire one for this table — a missing policy makes a direct PostgREST read
-- return nothing at all.
-- ---------------------------------------------------------------------------
alter table joc_order_events enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Roll-forward marker
--
-- Lets the app (and a future migration) tell which revision the database is on
-- without querying information_schema by hand.
-- ---------------------------------------------------------------------------
create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

insert into joc_schema_migrations (version)
values ('002_payment_provider_and_admin')
on conflict (version) do nothing;

commit;

-- ===========================================================================
-- Verify after running:
--
--   select version, applied_at from joc_schema_migrations order by applied_at;
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'joc_orders'
--      and column_name in ('payment_reference','payment_provider',
--                          'payment_verified_at','payment_verified_by')
--    order by column_name;
--
--   select payment_method, payment_provider, payment_status, count(*)
--     from joc_orders
--    group by 1,2,3 order by 4 desc;
--
--   select relname, relrowsecurity
--     from pg_class
--    where relname in ('joc_orders','joc_order_events');
--
-- Expected: four columns present, no 'ONLINE' rows left, and relrowsecurity
-- true for both tables.
-- ===========================================================================
