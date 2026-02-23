-- Run in Supabase SQL Editor
-- Supports:
-- 1) Auth sign-in/sign-up
-- 2) user profiles (username)
-- 3) remote 1v1 chess games with full rule state (castling/en-passant/repetition counters)

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_.-]{3,20}$')
);

create table if not exists public.chess_games (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  white_user_id uuid not null references auth.users(id) on delete cascade,
  black_user_id uuid references auth.users(id) on delete set null,
  board jsonb not null,
  state jsonb not null default '{}'::jsonb,
  turn text not null default 'w',
  status text not null default 'playing',
  winner text,
  history jsonb not null default '[]'::jsonb,
  last_move jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint join_code_format check (join_code ~ '^[A-Z0-9]{4,10}$'),
  constraint turn_check check (turn in ('w', 'b')),
  constraint status_check check (status in ('playing', 'checkmate', 'stalemate', 'draw')),
  constraint winner_check check (winner is null or winner in ('w', 'b'))
);

alter table public.chess_games add column if not exists state jsonb not null default '{}'::jsonb;
alter table public.chess_games alter column status set default 'playing';

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'chess_games'
      and constraint_name = 'status_check'
  ) then
    alter table public.chess_games drop constraint status_check;
  end if;
end $$;

alter table public.chess_games
  add constraint status_check check (status in ('playing', 'checkmate', 'stalemate', 'draw'));

create index if not exists chess_games_white_idx on public.chess_games(white_user_id);
create index if not exists chess_games_black_idx on public.chess_games(black_user_id);
create index if not exists chess_games_updated_idx on public.chess_games(updated_at desc);

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
for each row execute function public.set_updated_at();

drop trigger if exists chess_games_set_updated_at on public.chess_games;
create trigger chess_games_set_updated_at
before update on public.chess_games
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.chess_games enable row level security;

drop policy if exists profiles_select_all_auth on public.profiles;
create policy profiles_select_all_auth
on public.profiles
for select to authenticated
using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists chess_games_select_auth on public.chess_games;
create policy chess_games_select_auth
on public.chess_games
for select to authenticated
using (true);

drop policy if exists chess_games_insert_white_self on public.chess_games;
create policy chess_games_insert_white_self
on public.chess_games
for insert to authenticated
with check (
  white_user_id = auth.uid()
  and (black_user_id is null or black_user_id = auth.uid())
);

drop policy if exists chess_games_update_participant_or_open_join on public.chess_games;
create policy chess_games_update_participant_or_open_join
on public.chess_games
for update to authenticated
using (
  white_user_id = auth.uid()
  or black_user_id = auth.uid()
  or black_user_id is null
)
with check (
  white_user_id is not null
  and (white_user_id = auth.uid() or black_user_id = auth.uid() or black_user_id is null)
);
