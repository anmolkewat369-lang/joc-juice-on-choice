/**
 * Runtime DDL, executed at most once per cold start.
 *
 * Mirrors `db/schema.sql` — that file stays the reference for running the
 * migration by hand in the Supabase SQL editor. This copy exists so the API can
 * self-provision the table on first request and the client does not have to
 * open a SQL editor to try ordering. Every statement is idempotent.
 *
 * If you would rather provision explicitly, run db/schema.sql and set
 * JOC_AUTO_MIGRATE=false.
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
  address               text not null,
  landmark              text not null default '',
  special_instructions  text not null default '',
  items                 jsonb not null,
  subtotal              integer not null,
  delivery_charge       integer not null,
  total                 integer not null,
  currency              text not null default 'INR',
  payment_method        text not null check (payment_method in ('COD', 'ONLINE')),
  payment_status        text not null check (payment_status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  order_status          text not null check (order_status in ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
  razorpay_order_id     text unique,
  razorpay_payment_id   text,
  razorpay_signature    text,
  payment_method_used   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists joc_orders_created_at_idx on joc_orders (created_at desc);
create index if not exists joc_orders_status_idx on joc_orders (order_status, created_at desc);
create index if not exists joc_orders_payment_idx on joc_orders (payment_status, created_at desc);

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
`;
