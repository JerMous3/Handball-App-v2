-- Adds delete support + automatic 30-day cleanup for inactive invite codes.
-- Run once in the Supabase SQL editor (after login-limit-schema.sql).
--
-- A code can only ever be deleted while `active = false` (enforced both by
-- the admin UI and, defensively, by the delete query itself). `deactivated_at`
-- is kept in sync with `active` by a trigger so it doesn't matter whether a
-- code was deactivated from the admin UI or directly in SQL. A daily pg_cron
-- job then deletes any code that's been inactive for 30+ days.

alter table public.invite_codes
  add column if not exists deactivated_at timestamptz;

create or replace function public.set_invite_code_deactivated_at()
returns trigger
language plpgsql
as $$
begin
  if new.active = false and (old.active is distinct from false) then
    new.deactivated_at := now();
  elsif new.active = true then
    new.deactivated_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invite_code_deactivated_at on public.invite_codes;
create trigger trg_invite_code_deactivated_at
  before update on public.invite_codes
  for each row
  execute function public.set_invite_code_deactivated_at();

-- Backfill: any code that's already inactive starts its 30-day clock now.
update public.invite_codes
set deactivated_at = now()
where active = false and deactivated_at is null;

-- Admin (jeremybekkers@icloud.com) needs to delete codes from the admin UI.
drop policy if exists "Admin deletes invite codes" on public.invite_codes;
create policy "Admin deletes invite codes"
  on public.invite_codes
  for delete
  using (auth.jwt() ->> 'email' = 'jeremybekkers@icloud.com');

-- Daily cleanup job: permanently delete codes inactive for 30+ days.
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-old-inactive-invite-codes';

select cron.schedule(
  'delete-old-inactive-invite-codes',
  '0 3 * * *', -- daily at 03:00 UTC
  $$delete from public.invite_codes where active = false and deactivated_at < now() - interval '30 days';$$
);
