-- ===========================================================================
-- JOC — Juice On Choice | Migration 003
-- Record Cash on Delivery as payment_provider = 'cod'
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
--   payment_provider answers "which rail settles this payment?". For cash on
--   delivery the honest answer has always been "none", and migration 002 stored
--   NULL. The API now records the literal value 'cod' instead, so:
--
--     * every order carries a provider, and the admin dashboard never has to
--       render an empty provider cell;
--     * payment_provider becomes a total function of payment_method rather than
--       something that is sometimes populated and sometimes not.
--
--   'cod' is a label, not a switch. Cash on delivery was and remains always
--   available: this migration does not introduce a way to disable it, and it
--   changes no behaviour other than the recorded value.
--
-- Properties
--   * Additive. No DROP TABLE, no DELETE, no destructive rewrite.
--   * Widening only. The new CHECK accepts every value the old one accepted,
--     plus 'cod'. It cannot reject a row that was previously valid.
--   * Idempotent. Safe to run twice.
--   * Existing orders are preserved. Cash orders are backfilled to 'cod'; no
--     order is deleted, and no payment_status or order_status is touched.
--   * Row Level Security is untouched: still ENABLED, still no policy for anon
--     or authenticated.
--
-- ORDERING — IMPORTANT
--   The API writes payment_provider = 'cod' for every new cash order. Deploy
--   this migration BEFORE, or at the same moment as, the code change. If the
--   code is live while the CHECK still excludes 'cod', every Cash on Delivery
--   order fails to insert and the checkout appears completely broken.
--
--   If you deploy with JOC_AUTO_MIGRATE=true, api/_lib/schema.js applies this
--   same change on the first request and the manual run is unnecessary.
--
-- After running this, keep JOC_AUTO_MIGRATE=false so the API never executes DDL
-- at runtime.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Widen the CHECK to accept 'cod'
--
-- 'add constraint if not exists' does not exist in Postgres, so the constraint is
-- dropped and re-added inside a single statement pair. The previous definition
-- is a strict subset of the new one, so this cannot fail on existing data.
-- ---------------------------------------------------------------------------
alter table joc_orders drop constraint if exists joc_orders_payment_provider_check;
alter table joc_orders add constraint joc_orders_payment_provider_check
  check (payment_provider is null or payment_provider in ('cod', 'manual_upi', 'razorpay'));

comment on column joc_orders.payment_provider is
  'Settlement rail: cod (cash on delivery), manual_upi or razorpay (digital). Null only on rows written before migration 003.';

-- ---------------------------------------------------------------------------
-- 2. Backfill existing cash orders
--
-- A no-op on a database that never stored a provider for COD. Restricted to
-- payment_method = 'COD' so a row that somehow carries a digital provider is
-- left for a human to look at rather than silently relabelled.
-- ---------------------------------------------------------------------------
update joc_orders
   set payment_provider = 'cod'
 where payment_method = 'COD'
   and (payment_provider is null or payment_provider <> 'cod');

-- ---------------------------------------------------------------------------
-- 3. Guard
--
-- Abort loudly if any row still carries a provider outside the allowed set,
-- rather than letting the API discover it at checkout. The backfill above can
-- only fail to cover a row if a non-COD row holds a NULL provider, which is
-- legal, so this checks the constraint rather than assuming.
-- ---------------------------------------------------------------------------
do $$
declare
  offending bigint;
begin
  select count(*) into offending
    from joc_orders
   where payment_provider is not null
     and payment_provider not in ('cod', 'manual_upi', 'razorpay');

  if offending > 0 then
    raise exception
      'joc_orders has % row(s) with an unrecognised payment_provider. Inspect them before continuing.',
      offending;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Roll-forward marker
-- ---------------------------------------------------------------------------
create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

insert into joc_schema_migrations (version) values ('003_cod_payment_provider')
  on conflict (version) do nothing;

commit;
