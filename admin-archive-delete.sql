-- Lets the admin archive and permanently delete users and access requests
-- from admin.html. Run once in the Supabase SQL editor (as the `postgres`
-- role), after security-hardening.sql. Safe to re-run.
--
-- WHAT IT CHANGES
-- ----------------------------------------------------------------------------
--   1. profiles and access_requests get an `archived_at` column. NULL means
--      "not archived". Archiving only hides the row in the admin panel; it
--      does not lock the account or change the request.
--   2. Only the admin can set archived_at on a profile. Users cannot
--      archive or unarchive themselves, even if a policy later lets them
--      update their own profile.
--   3. Only the admin can read, update and delete access requests.
--   4. admin_delete_user() permanently deletes an account: its login
--      (auth.users), its profile and every row in a public table whose
--      user_id / coach_user_id is that account. Only the admin can call it,
--      and it refuses to delete the admin account.
--
-- Why a function for deleting users: deleting only the profile row would leave
-- the login in place, and register_login() lets an account without a profile
-- in. A deleted trial user would get unlimited access instead of being gone.

-- =========================================================== 1) columns

alter table public.profiles
  add column if not exists archived_at timestamptz;

alter table public.access_requests
  add column if not exists archived_at timestamptz;

-- ============================================== 2) profiles.archived_at guard

-- Same pattern as protect_profile_billing_fields() in security-hardening.sql:
-- browser requests (anon / authenticated) cannot change archived_at unless
-- they come from the admin account. Server-side code and the SQL editor can.
create or replace function public.protect_profile_archived_at()
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
    new.archived_at := null;
  else
    new.archived_at := old.archived_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_archived on public.profiles;
create trigger trg_protect_profile_archived
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_archived_at();

-- The admin already reads and updates every profile through the
-- "Admin manages all profiles" policy (login-limit-schema.sql), which also
-- covers setting archived_at. Nothing to add for profiles.

-- ===================================================== 3) access_requests

alter table public.access_requests enable row level security;

-- The public request form only inserts; that policy is left as it is.
-- These three let the admin, and only the admin, manage the requests.
drop policy if exists "Admin reads access requests" on public.access_requests;
create policy "Admin reads access requests"
  on public.access_requests
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com');

drop policy if exists "Admin updates access requests" on public.access_requests;
create policy "Admin updates access requests"
  on public.access_requests
  for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com')
  with check (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com');

drop policy if exists "Admin deletes access requests" on public.access_requests;
create policy "Admin deletes access requests"
  on public.access_requests
  for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com');

-- ===================================================== 4) delete a user

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  r       record;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'jeremybekkers@icloud.com' then
    raise exception 'Only the admin can delete users.'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'No user given.';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email = 'jeremybekkers@icloud.com' or p_user_id = auth.uid() then
    raise exception 'The admin account cannot be deleted.';
  end if;

  -- The user's own data in the app's tables (matches, rosters, seasons, live
  -- matches, ...). Found by column name so tables added later are covered too.
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name   = c.table_name
     where c.table_schema = 'public'
       and t.table_type   = 'BASE TABLE'
       and c.column_name in ('user_id', 'coach_user_id')
       and c.data_type    = 'uuid'
  loop
    execute format('delete from public.%I where %I = $1', r.table_name, r.column_name)
      using p_user_id;
  end loop;

  delete from public.profiles where id = p_user_id;

  -- The login itself. signup_invites and other tables that reference
  -- auth.users with "on delete cascade" go with it.
  delete from auth.users where id = p_user_id;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ============================================================ verification
--
-- Columns in place?
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'archived_at';
--   (expect profiles and access_requests)
--
-- Policies on access_requests?
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'access_requests';
--
-- Delete function there?
--   select proname from pg_proc where proname = 'admin_delete_user';
