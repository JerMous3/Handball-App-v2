-- Makes the trial login-limit actually work.
-- Run once in the Supabase SQL editor (as the `postgres` role).
--
-- THE PROBLEM
-- ----------------------------------------------------------------------------
-- The trial cap is written and enforced entirely from the browser:
--   * signup copies the code's login_limit onto the new profile   (index.html)
--   * each sign-in increments profiles.login_count                 (index.html)
--   * the gate reads the profile to decide whether to lock the account out
-- But `public.profiles` only grants access to the admin
-- (login-limit-schema.sql). A normal user has no policy, so every one of those
-- client writes is silently denied. The result:
--   * login_limit lands as NULL on every account  -> "unlimited", never capped
--   * login_count never moves off 0                -> the cap could never trip
-- The trial system looks configured but is completely inert.
--
-- THE FIX (all server-side, so RLS can't block it and users can't game it)
-- ----------------------------------------------------------------------------
--   1. A BEFORE INSERT trigger on profiles stamps login_limit from the invite
--      code the user signed up with (read from their auth metadata), for every
--      new account.
--   2. A SECURITY DEFINER function register_login() reads the trial status with
--      elevated rights and, for an explicit sign-in, increments the counter. It
--      only ever does login_count = login_count + 1 for the *calling* user, so a
--      user cannot reset their count or flip is_paid. index.html calls this
--      instead of touching profiles directly.
--   3. A one-time backfill gives existing trial accounts the limit their code
--      carries, so they are capped from here on too.
--
-- Paid accounts (is_paid = true) and codes with a NULL login_limit stay
-- uncapped, exactly as before.

-- ================================================================= 1) trigger

-- Stamp login_limit from the signup code at profile-creation time. SECURITY
-- DEFINER so it can read auth.users; search_path pinned and everything
-- schema-qualified. Only fills the value when it was not set explicitly, and
-- leaves it NULL (unlimited) when the code has no limit or has no code at all.
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

drop trigger if exists trg_set_profile_login_limit on public.profiles;
create trigger trg_set_profile_login_limit
  before insert on public.profiles
  for each row
  execute function public.set_profile_login_limit();

-- ================================================================= 2) counter

-- Called by the app on every entry point. Returns 'capped' when the account has
-- used up its trial and must be locked out, otherwise 'ok'. For an explicit
-- sign-in it also burns down one login. Reads/writes run with the function
-- owner's rights, so the RLS gap on profiles is irrelevant here.
--
-- Semantics match the old client code exactly: the cap trips on the entry
-- *after* login_count reaches login_limit (e.g. a limit of 100 allows 100
-- successful sign-ins, then blocks).
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

  -- No row yet, paid account, or unlimited code -> never capped.
  if not found or coalesce(v_paid, false) or v_limit is null then
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

-- ================================================================ 3) backfill

-- One-time: give existing, unpaid trial accounts the limit their signup code
-- carries. Only touches rows where login_limit is still NULL, so re-running is
-- safe. The admin account is left alone.
update public.profiles p
   set login_limit = ic.login_limit
  from auth.users u
  join public.invite_codes ic
    on upper(ic.code) = upper(nullif(btrim(u.raw_user_meta_data ->> 'invite_code'), ''))
 where p.id = u.id
   and p.login_limit is null
   and p.is_paid = false
   and u.email is distinct from 'jeremybekkers@icloud.com';

-- ============================================================= verification
--
-- Are the trigger and function registered?
--   select tgname from pg_trigger
--    where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--   select proname from pg_proc where proname = 'register_login';
--
-- After backfill, trial accounts should now show their limit (e.g. 100):
--   select email, login_count, login_limit, is_paid from public.profiles
--    order by login_limit nulls last;
--
-- End-to-end: create a fresh account with a limited code and confirm the new
-- profile row now carries that login_limit instead of NULL.
