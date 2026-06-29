-- Seasons table: lets users create season names ahead of time (before any
-- matches exist in them). Run this once in the Supabase SQL editor.
--
-- A "season" is otherwise just a text label on rows in `matches`; this table
-- stores names that have no matches yet so they still appear in the season
-- pickers and sync across devices.

create table if not exists public.seasons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.seasons enable row level security;

-- Each user can only see and manage their own seasons.
drop policy if exists "Users manage own seasons" on public.seasons;
create policy "Users manage own seasons"
  on public.seasons
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
