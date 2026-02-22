-- Run this in Supabase SQL Editor (free tier works)
-- This schema supports:
-- 1) Supabase Auth login/signup
-- 2) per-user portfolio persistence
-- 3) league-based leaderboard (friends compete with a shared league_code)

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  league_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_.-]{3,20}$'),
  constraint league_code_format check (league_code ~ '^[A-Za-z0-9_-]{3,32}$')
);

create table if not exists public.portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  league_code text not null,
  cash numeric not null default 1000000,
  positions jsonb not null default '{}'::jsonb,
  watchlist jsonb not null default '["AAPL","MSFT","TSLA","NVDA"]'::jsonb,
  selected_symbol text not null default 'AAPL',
  updated_at timestamptz not null default now()
);

create index if not exists portfolios_league_code_idx on public.portfolios(league_code);
create index if not exists profiles_league_code_idx on public.profiles(league_code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists portfolios_set_updated_at on public.portfolios;
create trigger portfolios_set_updated_at
before update on public.portfolios
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;

drop policy if exists "profiles_select_same_league" on public.profiles;
create policy "profiles_select_same_league"
on public.profiles
for select
to authenticated
using (
  league_code in (
    select p.league_code
    from public.profiles p
    where p.user_id = auth.uid()
  )
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "portfolios_select_same_league" on public.portfolios;
create policy "portfolios_select_same_league"
on public.portfolios
for select
to authenticated
using (
  league_code in (
    select p.league_code
    from public.profiles p
    where p.user_id = auth.uid()
  )
);

drop policy if exists "portfolios_insert_self" on public.portfolios;
create policy "portfolios_insert_self"
on public.portfolios
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "portfolios_update_self" on public.portfolios;
create policy "portfolios_update_self"
on public.portfolios
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

