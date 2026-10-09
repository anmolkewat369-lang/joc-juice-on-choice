-- ===========================================================================
-- JOC — Juice On Choice | Migration 007
-- Persistent menu-item availability
--
-- Run once in the Supabase SQL editor before deploying the matching API:
-- Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- This additive table stores admin-selected overrides only. Items without an
-- override remain available, so existing menu content and orders are untouched.
-- ===========================================================================

begin;

create table if not exists joc_menu_availability (
  item_id    text primary key,
  status     text not null default 'available'
               check (status in ('available', 'out_of_stock', 'coming_soon')),
  updated_at timestamptz not null default now(),
  updated_by text not null
);

comment on table joc_menu_availability is
  'Admin-managed availability overrides keyed by the stable item ids in src/data/menu.js. Missing rows mean available. Writes go through the authenticated server API only.';

alter table joc_menu_availability enable row level security;

create table if not exists joc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

insert into joc_schema_migrations (version) values ('007_menu_availability')
  on conflict (version) do nothing;

commit;
