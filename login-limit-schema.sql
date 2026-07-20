-- Adds trial login-limit tracking to invite codes and user profiles.
-- Run once in the Supabase SQL editor.
--
-- An invite code can carry a `login_limit` (e.g. 5 or 10). Accounts created
-- from that code copy the limit onto their own profile. Every explicit
-- sign-in (not page refreshes / session restores) increments
-- `profiles.login_count`; once it reaches `login_limit`, the account is
-- locked out of the app until an admin sets `profiles.is_paid = true`,
-- which removes the cap entirely. A null login_limit means unlimited
-- (used for paid/club codes that shouldn't ever be capped).

alter table public.invite_codes
  add column if not exists login_limit integer;

alter table public.profiles
  add column if not exists email text,
  add column if not exists login_count integer not null default 0,
  add column if not exists login_limit integer,
  add column if not exists is_paid boolean not null default false;

-- Admin (jeremybekkers@icloud.com) needs to read/update every profile to
-- show the trial-users list and flip is_paid. If you already have a
-- broader "admin can do anything" policy on profiles, this is redundant
-- but harmless.
drop policy if exists "Admin manages all profiles" on public.profiles;
create policy "Admin manages all profiles"
  on public.profiles
  for all
  using (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com')
  with check (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com');
