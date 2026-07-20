-- Automatic deletion of personal data we no longer need.
-- Run once in the Supabase SQL editor (alongside invite-code-cleanup.sql).
--
-- Under the AVG personal data may not be kept longer than necessary for the
-- purpose it was collected for. Two tables accumulate personal data with no
-- natural end:
--
--   access_requests : name, email, phone, free-text message
--   error_logs      : user id, user agent, URL, stack traces
--
-- The periods below are published in the privacy statement at
-- handball-tracker.com/privacy.html. CHANGE THEM IN BOTH PLACES OR NEITHER.
-- A published retention period the database ignores is worse than none.
--
--   access_requests : 6 months (183 days) after the request was processed
--   error_logs      : 90 days after the error occurred
--
-- Requests still 'pending' are never deleted, so an unanswered request cannot
-- quietly disappear before anyone acts on it.
--
-- No new columns or triggers are needed: the admin UI already stamps
-- processed_at when a request is approved or rejected.

-- ---------------------------------------------------------------- preflight
--
-- Fails loudly rather than silently scheduling a job that deletes nothing.
-- error_logs is only ever written to (index.html), never read, so its column
-- names are not exercised anywhere in the app.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'access_requests'
      and column_name = 'processed_at'
  ) then
    raise exception 'access_requests.processed_at is missing. The admin UI writes it on approve/reject; check the table before scheduling cleanup.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'error_logs'
      and column_name = 'created_at'
  ) then
    raise exception 'error_logs.created_at is missing. Substitute the actual timestamp column below before running.';
  end if;
end;
$$;

-- ---------------------------------------------------------------- scheduling

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'delete-old-access-requests';
select cron.unschedule(jobid) from cron.job where jobname = 'delete-old-error-logs';

select cron.schedule(
  'delete-old-access-requests',
  '15 3 * * *', -- daily at 03:15 UTC, after the invite-code job at 03:00
  $$delete from public.access_requests
    where status is distinct from 'pending'
      and processed_at is not null
      and processed_at < now() - interval '183 days';$$
);

select cron.schedule(
  'delete-old-error-logs',
  '30 3 * * *', -- daily at 03:30 UTC
  $$delete from public.error_logs where created_at < now() - interval '90 days';$$
);

-- ---------------------------------------------------------------- verification
--
-- Both jobs registered?
--   select jobname, schedule, active from cron.job order by jobname;
--
-- What would the next run remove? (counts only, deletes nothing)
--   select count(*) from public.access_requests
--    where status is distinct from 'pending'
--      and processed_at is not null
--      and processed_at < now() - interval '183 days';
--
--   select count(*) from public.error_logs
--    where created_at < now() - interval '90 days';
--
-- ---------------------------------------------------------------- see also
--
-- error_logs is write-only: nothing in the app or the admin UI ever reads it.
-- A table nobody reads, holding user ids and user agents, is hard to justify
-- under data minimisation. Worth deciding whether to build a view for it, stop
-- recording user_agent and user_id, or drop the table. Retention alone caps
-- the damage rather than answering the question.
