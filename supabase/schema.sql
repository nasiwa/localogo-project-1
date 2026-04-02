-- ============================================================
-- LOKALOGO OSPEK PRE-ORDER — SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- EXTENSIONS
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLE: batches
-- ============================================================
create table if not exists batches (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null unique,           -- "Batch 1", "Batch 2", ...
  total_slots   int  not null default 200,
  filled_slots  int  not null default 0,
  status        text not null default 'hidden', -- 'hidden' | 'active' | 'closed'
  reveal_at     timestamptz,                    -- scheduled reveal time (null = manual)
  wa_group_url  text,                           -- unique WA group link for each batch
  created_at    timestamptz default now(),
  sort_order    int  not null default 1
);

-- Ensure columns exist if table was already created
alter table batches add column if not exists wa_group_url text;

-- Add unique constraint to name if not exists (for existing tables)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'batches_name_key'
  ) then
    alter table batches add constraint batches_name_key unique (name);
  end if;
end $$;

-- ============================================================
-- TABLE: orders
-- ============================================================
create table if not exists orders (
  id              uuid primary key default uuid_generate_v4(),
  order_ref       text not null unique,          -- PO-OSPEK-XXXXXX
  batch_id        uuid references batches(id),
  full_name       text not null,
  email           text not null,
  whatsapp        text not null,
  amount          int  not null default 100000,  -- in IDR
  status          text not null default 'pending', -- pending | paid | expired | failed
  midtrans_token  text,
  midtrans_va     text,
  paid_at         timestamptz,
  snap_redirect   text,
  sequence_num    int,                           -- Participant sequence in batch (e.g. 1-1000)
  is_picked_up    boolean default false,        -- Anti-cheat pickup status
  picked_up_at    timestamptz,
  scanned_by      text,                          -- Which Loket/Admin scanned this code
  created_at      timestamptz default now()
);

-- Ensure columns exist if table was already created
alter table orders add column if not exists is_picked_up boolean default false;
alter table orders add column if not exists picked_up_at timestamptz;
alter table orders add column if not exists sequence_num int;
alter table orders add column if not exists scanned_by text;

-- ============================================================
-- TABLE: admin_users  (Google OAuth whitelist)
-- ============================================================
create table if not exists admin_users (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null unique,
  created_at timestamptz default now()
);

-- Insert your admin email here
-- INSERT INTO admin_users (email) VALUES ('youremail@gmail.com');

-- ============================================================
-- RPC: claim_slot  (ULTRA-CONCURRENCY-SAFE)
-- Uses explicit table locking to prevent any over-booking
-- ============================================================
create or replace function claim_slot(p_batch_id uuid, p_order_ref text, p_name text, p_email text, p_wa text)
returns json
language plpgsql
security definer
as $$
declare
  v_total_slots   int;
  v_filled_slots  int;
  v_pending_slots int;
  v_slots_left    int;
  v_batch_name    text;
  v_order_id      uuid;
begin
  -- 1. Lock the base table row immediately to queue concurrent requests
  select name, total_slots, filled_slots 
  into v_batch_name, v_total_slots, v_filled_slots
  from batches
  where id = p_batch_id and status = 'active'
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'Batch tidak tersedia atau sudah penuh');
  end if;

  -- 2. Count current pending orders manually (view might have cache/delay)
  select count(*) into v_pending_slots
  from orders
  where batch_id = p_batch_id 
    and status = 'pending'
    and created_at > (now() - interval '30 minutes');

  -- 3. Calculate real slots left
  v_slots_left := v_total_slots - v_filled_slots - v_pending_slots;

  if v_slots_left <= 0 then
    -- Double check if we should close it
    if v_filled_slots >= v_total_slots then
      update batches set status = 'closed' where id = p_batch_id;
    end if;
    return json_build_object('success', false, 'error', 'Maaf, slot baru saja habis dibooking orang lain.');
  end if;

  -- 4. Insert order
  insert into orders (order_ref, batch_id, full_name, email, whatsapp)
  values (p_order_ref, p_batch_id, p_name, p_email, p_wa)
  returning id into v_order_id;

  return json_build_object(
    'success',   true,
    'order_id',  v_order_id,
    'order_ref', p_order_ref,
    'batch_name', v_batch_name,
    'slots_left', v_slots_left - 1
  );
end;
$$;

-- ============================================================
-- RPC: confirm_payment  (called by webhook after settlement)
-- ============================================================
create or replace function confirm_payment(p_order_ref text)
returns json
language plpgsql
security definer
as $$
declare
  v_order   orders%rowtype;
  v_batch   batches%rowtype;
  v_new_filled int;
begin
  -- Lock order
  select * into v_order
  from orders
  where order_ref = p_order_ref and status = 'pending'
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'Order tidak ditemukan atau sudah diproses');
  end if;

  -- Lock batch
  select * into v_batch
  from batches
  where id = v_order.batch_id
  for update;

  -- Double-check quota
  if v_batch.filled_slots >= v_batch.total_slots then
    return json_build_object('success', false, 'error', 'Slot penuh');
  end if;

  -- Deduct slot (Increment filled_slots)
  v_new_filled := v_batch.filled_slots + 1;
  
  update batches
  set filled_slots = v_new_filled,
      status = case when v_new_filled >= total_slots then 'closed' else status end
  where id = v_batch.id;

  -- Mark order paid
  update orders
  set status = 'paid', 
      paid_at = now(),
      sequence_num = v_new_filled
  where id = v_order.id;

  return json_build_object(
    'success',    true,
    'order_id',   v_order.id,
    'order_ref',  v_order.order_ref,
    'full_name',  v_order.full_name,
    'email',      v_order.email,
    'whatsapp',   v_order.whatsapp,
    'batch_name', v_batch.name,
    'batch_num',  coalesce(substring(v_batch.name from '[0-9]+'), '1'),
    'sequence',   v_new_filled,
    'wa_group_url', v_batch.wa_group_url
  );
end;
$$;

-- ============================================================
-- RPC: auto_reveal_batches (call via cron or on each page load)
-- Reveals batches whose reveal_at time has passed
-- ============================================================
create or replace function auto_reveal_batches()
returns void
language plpgsql
security definer
as $$
begin
  update batches
  set status = 'active'
  where status = 'hidden'
    and reveal_at is not null
    and reveal_at <= now();
end;
$$;

-- ============================================================
-- VIEWS
-- ============================================================

-- Public view (counts pending orders as reserved)
create or replace view public_batches as
with pending_counts as (
  select batch_id, count(*) as pending_count
  from orders
  where status = 'pending'
    and created_at > (now() - interval '30 minutes')
  group by batch_id
)
select
  b.id,
  b.name,
  b.total_slots,
  b.filled_slots,
  coalesce(p.pending_count, 0) as pending_slots,
  b.status,
  case 
    when (b.total_slots - b.filled_slots - coalesce(p.pending_count, 0)) < 0 then 0
    else (b.total_slots - b.filled_slots - coalesce(p.pending_count, 0))
  end as slots_left
from batches b
left join pending_counts p on p.batch_id = b.id
where b.status in ('active', 'closed')
order by b.sort_order;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table batches    enable row level security;
alter table orders     enable row level security;
alter table admin_users enable row level security;

-- Drop existing policies if they exist (PostgreSQL doesn't have CREATE OR REPLACE POLICY)
drop policy if exists "public_read_batches" on batches;
drop policy if exists "insert_orders" on orders;
drop policy if exists "service_update_orders" on orders;
drop policy if exists "admin_read" on admin_users;

-- Batches: public can read active/closed only
create policy "public_read_batches" on batches
  for select using (status in ('active','closed'));

-- Orders: users can insert pending orders (via RPC is safer)
create policy "insert_orders" on orders
  for insert with check (true);

-- Orders: only service_role can update (webhook)
create policy "service_update_orders" on orders
  for update using (auth.role() = 'service_role');

-- Admin: only service_role reads admin_users
create policy "admin_read" on admin_users
  for select using (auth.role() = 'service_role');

-- ============================================================
-- REALTIME
-- ============================================================
-- Check if table is already in publication to avoid "already exists" error
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'batches'
  ) then
    alter publication supabase_realtime add table batches;
  end if;
end $$;

-- ============================================================
-- SEED: 5 batches
-- ============================================================
insert into batches (name, total_slots, filled_slots, status, sort_order, reveal_at) values
  ('Batch 1', 200, 0, 'active',  1, null),
  ('Batch 2', 200, 0, 'hidden',  2, null),
  ('Batch 3', 200, 0, 'hidden',  3, null),
  ('Batch 4', 200, 0, 'hidden',  4, null),
  ('Batch 5', 200, 0, 'hidden',  5, null)
on conflict (name) do nothing;
