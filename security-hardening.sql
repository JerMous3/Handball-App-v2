-- Closes the gaps found in a review of the RLS policies and RPC functions.
-- Run once in the Supabase SQL editor (as the `postgres` role), after
-- trial-login-limit-enforcement.sql. Safe to re-run.
--
-- WHAT IT CHANGES
-- ----------------------------------------------------------------------------
--   1. Invite codes can no longer be listed by anyone with the public key.
--      The signup form checks a single code through check_invite_code().
--   2. Invite codes are checked and counted by the database when an account
--      is created, not by the browser. An account created without a valid
--      code (e.g. by calling Supabase's signup API directly) starts locked
--      out, like a used-up trial, until the admin marks it paid.
--      increment_invite_usage() can no longer be called from the browser, so
--      nobody can use up a club's code by calling it repeatedly.
--   3. Users can no longer change their own is_paid / login_count /
--      login_limit. Only register_login(), other server-side code and the
--      admin account can.
--   4. update_live_match_score() only updates the caller's own live match,
--      and only the coach can add events to a live match.
--   5. error_logs rows can only be filed with no user or the caller's own id.
--   6. Tables the app no longer uses lose their open policies, and the two
--      unused views are no longer reachable through the API. The data stays.
--
-- index.html calls check_invite_code() from the same change, so run this
-- right before or after that version is deployed. In between, the signup
-- form reports every invite code as invalid.

-- ======================================================== 1) invite codes

-- Checks one code for the signup form. Returns only what signup needs, so the
-- codes themselves stay private.
create or replace function public.check_invite_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.invite_codes%rowtype;
begin
  select *
    into v
    from public.invite_codes ic
   where upper(ic.code) = upper(btrim(p_code))
     and ic.active
   limit 1;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v.expires_at is not null and v.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if v.max_uses is not null and coalesce(v.uses_count, 0) >= v.max_uses then
    return jsonb_build_object('status', 'full');
  end if;

  return jsonb_build_object(
    'status',      'ok',
    'club_name',   v.club_name,
    'plan_type',   v.plan_type,
    'login_limit', v.login_limit
  );
end;
$$;

revoke execute on function public.check_invite_code(text) from public;
grant execute on function public.check_invite_code(text) to anon, authenticated;

drop policy if exists "Public can validate codes" on public.invite_codes;

-- ============================================================== 2) signups

-- Which invite code each account was created with, and whether it was valid
-- at that moment. Written only by check_signup_invite(); no policies, so the
-- API cannot read or write it. Accounts created before this file was run have
-- no row and keep their old behaviour.
create table if not exists public.signup_invites (
  user_id     uuid primary key
              references auth.users (id) on delete cascade
              deferrable initially deferred,
  invite_code text,
  valid       boolean not null,
  created_at  timestamptz not null default now()
);

alter table public.signup_invites enable row level security;
revoke all on public.signup_invites from anon, authenticated;

-- Runs when Supabase Auth creates an account. Checks the invite code from the
-- signup metadata, counts a use of it (what increment_invite_usage() did from
-- the browser), and records the result. Never blocks the signup itself: if
-- anything goes wrong it warns and lets the account through unrecorded.
-- The foreign key above is deferred because this runs before the auth.users
-- row exists.
create or replace function public.check_signup_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code  text := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');
  v_club  text;
  v_valid boolean := false;
begin
  if v_code is not null then
    select ic.club_name
      into v_club
      from public.invite_codes ic
     where upper(ic.code) = upper(v_code)
       and ic.active
       and (ic.expires_at is null or ic.expires_at > now())
       and (ic.max_uses is null or coalesce(ic.uses_count, 0) < ic.max_uses)
     limit 1
     for update;
    v_valid := found;
  end if;

  if v_valid then
    update public.invite_codes
       set uses_count = coalesce(uses_count, 0) + 1,
           updated_at = now()
     where upper(code) = upper(v_code);

    update public.club_subscriptions
       set current_users = current_users + 1,
           updated_at = now()
     where club_name = v_club;
  end if;

  insert into public.signup_invites (user_id, invite_code, valid)
  values (new.id, v_code, v_valid)
  on conflict (user_id) do nothing;

  return new;
exception
  when others then
    raise warning 'check_signup_invite failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_check_signup_invite on auth.users;
create trigger trg_check_signup_invite
  before insert on auth.users
  for each row
  execute function public.check_signup_invite();

-- Counting now happens in check_signup_invite(). Anyone could call this
-- function, so it could be used to burn through a club's code.
revoke execute on function public.increment_invite_usage(text) from public, anon, authenticated;

-- ============================================================= 3) profiles

-- Keeps the trial/billing columns out of users' hands. SECURITY INVOKER on
-- purpose, so current_user is the caller: browser requests run as anon or
-- authenticated, while register_login(), handle_new_user(), the SQL editor and
-- the service role run as other roles and are trusted, as is the admin.
create or replace function public.protect_profile_billing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated')
     or coalesce(auth.jwt() ->> 'email', '') = 'jeremybekkers@icloud.com' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_paid     := false;
    new.login_count := 0;
    new.login_limit := null;  -- filled in by set_profile_login_limit()
  else
    new.is_paid     := old.is_paid;
    new.login_count := old.login_count;
    new.login_limit := old.login_limit;
  end if;
  return new;
end;
$$;

-- Named to sort before trg_set_profile_login_limit: same-event triggers fire
-- in name order, and this one must clear login_limit before that one fills it.
drop trigger if exists trg_protect_profile_billing on public.profiles;
create trigger trg_protect_profile_billing
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_billing_fields();

-- Supersedes the version in trial-login-limit-enforcement.sql: an account
-- created without a valid invite code starts with login_limit 0 (locked).
create or replace function public.set_profile_login_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if new.login_limit is null then
    if exists (
      select 1 from public.signup_invites s
       where s.user_id = new.id and not s.valid
    ) then
      new.login_limit := 0;
      return new;
    end if;

    select nullif(btrim(u.raw_user_meta_data ->> 'invite_code'), '')
      into v_code
      from auth.users u
     where u.id = new.id;

    if v_code is not null then
      select ic.login_limit
        into new.login_limit
        from public.invite_codes ic
       where upper(ic.code) = upper(v_code)
       limit 1;
    end if;
  end if;
  return new;
end;
$$;

-- Supersedes the version in trial-login-limit-enforcement.sql: an account with
-- no profile row is only let through if it did not sign up with an invalid code.
create or replace function public.register_login(p_is_explicit boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
  v_limit integer;
  v_paid  boolean;
begin
  if v_uid is null then
    return 'ok';
  end if;

  select login_count, login_limit, is_paid
    into v_count, v_limit, v_paid
    from public.profiles
   where id = v_uid;

  if not found then
    if exists (
      select 1 from public.signup_invites s
       where s.user_id = v_uid and not s.valid
    ) then
      return 'capped';
    end if;
    return 'ok';
  end if;

  -- Paid account or unlimited code -> never capped.
  if coalesce(v_paid, false) or v_limit is null then
    return 'ok';
  end if;

  if v_count >= v_limit then
    return 'capped';
  end if;

  if p_is_explicit then
    update public.profiles
       set login_count = login_count + 1
     where id = v_uid;
  end if;

  return 'ok';
end;
$$;

grant execute on function public.register_login(boolean) to authenticated;

-- ========================================================== 4) live matches

-- Was SECURITY DEFINER with no owner check, so anyone could change the score
-- of any live match.
create or replace function public.update_live_match_score(
  p_live_match_id uuid,
  p_score_home integer,
  p_score_away integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.live_matches
     set score_home = p_score_home,
         score_away = p_score_away,
         updated_at = now()
   where id = p_live_match_id
     and coach_user_id = auth.uid();  -- only the coach broadcasting the match
end;
$$;

-- Already checks the owner; pin its search_path like the other functions.
alter function public.end_live_match(uuid) set search_path = public;

-- Let any signed-in user add events to any match, overriding the coach-only
-- policy next to it.
drop policy if exists "Authenticated users can insert events" on public.live_events;

-- ============================================================= 5) error logs

-- Allowed any user_id. The remaining insert policies allow no user or the
-- caller's own id, which is what index.html sends.
drop policy if exists "Anyone can insert error logs" on public.error_logs;

-- ===================================================== 6) unused tables/views

-- Not used by the app. With RLS on and no open policies they are unreachable
-- through the API; the data is kept.
drop policy if exists "Anyone can check email approval" on public.approved_emails;
drop policy if exists "Anyone can read approved emails" on public.approved_emails;
drop policy if exists "Authenticated users can manage stats" on public.live_match_stats;
drop policy if exists "Anyone can view live stats" on public.live_match_stats;
drop policy if exists "Anyone can track viewing" on public.live_match_viewers;
drop policy if exists "Anyone can insert match summaries" on public.match_summaries;
drop policy if exists "Anyone can view match summaries" on public.match_summaries;
drop policy if exists "Anyone can insert player season stats" on public.player_season_stats;
drop policy if exists "Anyone can update player season stats" on public.player_season_stats;
drop policy if exists "Anyone can view player season stats" on public.player_season_stats;
drop policy if exists "Anyone can insert shot map history" on public.shot_map_history;
drop policy if exists "Anyone can view shot map history" on public.shot_map_history;

-- Views run with their owner's rights and skip the tables' RLS, so anything
-- they select was readable by anyone with the public key.
revoke all on public.active_customers from anon, authenticated;
revoke all on public.match_replays from anon, authenticated;

-- ============================================================ verification
--
-- New functions and triggers in place?
--   select tgname from pg_trigger
--    where tgrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
--      and not tgisinternal;
--   (expect trg_check_signup_invite, trg_protect_profile_billing alongside
--    the existing on_auth_user_created and trg_set_profile_login_limit)
--
-- After the next signup, its invite check should be recorded:
--   select * from public.signup_invites order by created_at desc limit 5;
