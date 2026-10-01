-- ===========================================================================
-- JOC — Juice On Choice | Migration 005
-- Delivery area selection and customer address confirmation
--
-- Target : Supabase Postgres (project hebviqzbqpukjvyuqrxu)
-- Run it : ONCE, in the Supabase SQL editor
--          Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run this through the Supabase *transaction* pooler. Transaction
-- pooling is the right choice for the serverless runtime, but not for a
-- multi-statement DDL script: the session is handed between backends, so
-- session state cannot be relied upon. The SQL editor connects directly.
--
-- WHY
--   JOC no longer measures an address against a store pin. It publishes a list
--   of areas (src/data/deliveryAreas.js), the customer picks one, and they
--   explicitly confirm the address they typed is correct and inside that area.
--   An order row needs to carry both facts, because they are what an admin reads
--   before deciding whether the order can be delivered:
--
--     delivery_area           the id chosen from the configured list
--     delivery_area_confirmed the customer's own acknowledgement
--
--   There is no distance to store, because nothing measures one. An admin can no
--   longer be told "4.2 km by road", and the database stops implying that the
--   server knows something it does not.
--
-- WHAT IS NOT TOUCHED
--   The delivery_distance_meters / delivery_radius_km / delivery_eligible /
--   delivery_outcome / delivery_checked_at columns from migration 004 are left in
--   place, exactly as written. They are not dropped, not rewritten and not
--   nulled. Those columns hold real history — orders placed and accepted under the
--   old road-distance rule — and dropping them would throw that away for no gain.
--   The new code neither reads nor writes them, so they simply stop moving.
--
--   Leaving them also means this migration is strictly additive, so it can be run
--   before, during or after a deploy without breaking the version currently
--   serving traffic.
--
-- NO CONSTRAINT ON delivery_area — DELIBERATE
--   The list of valid areas lives in src/data/deliveryAreas.js, not in the
--   database. A CHECK constraint or an enum here would be a second copy of that
--   list, and the two would drift: rename an area for JOC and every historical
--   order carrying the old id would fail to insert or, worse, be rewritten into
--   something it never was. Membership is enforced server-side by
--   validateDeliveryArea in shared/delivery.js, which reads that one list.
--
--   The cost is that the database cannot, on its own, tell a valid area from an
--   invalid one. That is acceptable: nothing but the API writes this table.
--
-- NO DEFAULT ON delivery_area_confirmed — DELIBERATE
--   A DEFAULT true would manufacture a confirmation no customer made, and every
--   row written by a future insert that forgot the column would claim one.
--   NULL means "this order predates the area list", which is a different fact from
--   false and is exactly what is true of orders placed before this migration.
--
-- Properties
--   * Additive. No DROP, no DELETE, no rewrite of existing rows.
--   * Idempotent. Safe to run twice.
--   * Existing orders, payments, events, notifications and admin users preserved.
--   * Row Level Security left enabled with no policies, matching the rest.
--
-- ORDERING
--   Deploy this migration BEFORE, or at the same moment as, the code change that
--   writes these two columns — otherwise order creation fails on unknown columns.
--
--   If you deploy with JOC_AUTO_MIGRATE=true, api/_lib/schema.js applies this same
--   change on the first request and the manual run is unnecessary.
--
--   After running this, keep JOC_AUTO_MIGRATE=false so the API never executes DDL
--   at runtime.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The area the customer selected, and their confirmation of the address
-- ---------------------------------------------------------------------------
alter table joc_orders add column if not exists delivery_area text;
alter table joc_orders add column if not exists delivery_area_confirmed boolean;

comment on column joc_orders.delivery_area is
  'Id of the delivery area the customer chose from src/data/deliveryAreas.js, validated server-side by shared/delivery.js. Not constrained here so the list has exactly one home. NULL = placed before migration 005.';

comment on column joc_orders.delivery_area_confirmed is
  'True only when the customer explicitly confirmed their address is correct and within JOC''s delivery area. NULL = placed before migration 005, which is different from false.';

-- ---------------------------------------------------------------------------
-- 2. Roll-forward marker
-- ---------------------------------------------------------------------------
create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

insert into joc_schema_migrations (version) values ('005_delivery_area_confirmation')
  on conflict (version) do nothing;

commit;