-- SQL Schema setup for Noir QR Ordering
-- Run this in your Supabase SQL Editor if you need to recreate the table structure: https://supabase.com/dashboard/project/_/sql

-- Create the orders table matching your exact database schema
create table if not exists public.orders (
  id uuid default gen_random_uuid() primary key,
  order_no text, -- Custom order prefix
  table_number text not null,
  guest_name text not null,
  items jsonb not null, -- Array of { id, name, price, quantity }
  total numeric not null,
  status text not null default 'new', -- 'new', 'preparing', 'ready', 'paid'
  payment_method text, -- 'cash', 'online'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.orders enable row level security;

-- Create policies for public access
create policy "Allow public inserts" on public.orders for insert with check (true);
create policy "Allow public select" on public.orders for select using (true);
create policy "Allow public update" on public.orders for update using (true);
create policy "Allow public delete" on public.orders for delete using (true);

-- Enable Realtime for orders table
begin;
  -- remove the table from publication if it exists to avoid duplication
  alter publication supabase_realtime drop table if exists public.orders;
  -- add the table to publication
  alter publication supabase_realtime add table public.orders;
commit;
