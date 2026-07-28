-- Emails the admin the moment a new access request is submitted.
-- Run once in the Supabase SQL editor (as the `postgres` role, which the
-- editor uses by default).
--
-- WHY THIS EXISTS
-- ----------------------------------------------------------------------------
-- The "Request Access" form on the site (submitAccessRequest in index.html)
-- only INSERTs a row into `public.access_requests` with status 'pending'.
-- Nothing tells anyone a request arrived, so the only way to notice a new
-- subscriber was to open admin.html and check the list by hand. This adds an
-- AFTER INSERT trigger that, through Resend, sends TWO emails on each request:
--
--   1. To the admin (info@handball-tracker.com) — so a new subscriber lands in
--      the inbox instead of waiting to be discovered. The request row is still
--      recorded, so the admin panel remains the full list of who signed up.
--   2. To the subscriber — an automatic welcome with the current invite code
--      (v_invite_code, set in the trigger function below) and step-by-step
--      sign-up instructions. This replaces manually emailing each person the
--      code. To change which code goes out, edit v_invite_code and re-run.
--
-- Both emails are fire-and-forget (pg_net queues them and returns immediately)
-- and every failure path is swallowed with a warning: a notification problem
-- must never roll back the subscriber's request. Losing the request would be
-- worse than losing the email.
--
-- NOTE: the invite code is sent to everyone who submits the form, so keep an
-- eye on its usage cap in the admin panel — once a shared code hits its
-- max_uses, sign-up will start failing for new people until you raise the
-- limit or swap in a fresh code here.
--
-- ONE-TIME SETUP (do this before running the rest of the file)
-- ----------------------------------------------------------------------------
--   1. Create a Resend account and verify the domain you send *from*
--      (handball-tracker.com). Resend silently drops mail from an unverified
--      domain, so this step is not optional. See https://resend.com/domains
--   2. Create a Resend API key (https://resend.com/api-keys).
--   3. Store the key in Supabase Vault under the name `resend_api_key` so it
--      never has to live in this file or in the repo. Run once:
--
--        select vault.create_secret('re_your_real_key_here', 'resend_api_key');
--
--      (To rotate later: select vault.update_secret(
--          (select id from vault.secrets where name = 'resend_api_key'),
--          're_new_key_here');)
--   4. Run everything below.
--
-- WHERE THE ADDRESSES ARE SET
-- ----------------------------------------------------------------------------
-- The from/to/reply-to addresses are literals near the top of the trigger
-- function, matching how the admin email is hard-coded elsewhere in this
-- project (login-limit-schema.sql, admin.html). To change who gets notified,
-- edit `v_to` and re-run this file.

-- ---------------------------------------------------------------- extensions

-- pg_net gives us net.http_post for outbound HTTP from Postgres.
create extension if not exists pg_net;

-- ---------------------------------------------------------------- html escape

-- The name/message fields are free text typed by strangers, and we drop them
-- into an HTML email body. Escape them so a stray '<' or '&' can't mangle the
-- markup (or slip anything past the mail client).
create or replace function public.access_request_html_escape(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(
           coalesce(t, ''),
           '&', '&amp;'),
           '<', '&lt;'),
           '>', '&gt;'),
           '"', '&quot;'),
           '''', '&#39;');
$$;

-- ---------------------------------------------------------------- trigger fn

-- SECURITY DEFINER so the anonymous role that inserts the request (the public
-- form uses the anon Supabase client) can still read the Vault secret and call
-- pg_net through this function. search_path is pinned empty and every object is
-- schema-qualified so nothing can be shadowed by a caller-controlled path.
create or replace function public.notify_admin_of_access_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api_key     text;
  v_from        text := 'Handball Tracker <notifications@handball-tracker.com>';
  v_to          text := 'info@handball-tracker.com';
  -- The invite code auto-emailed to every new subscriber so they can create an
  -- account without waiting for manual approval. To hand out a different code
  -- later, change this one line and re-run this file. It must match an active
  -- row in public.invite_codes (and stay in UPPERCASE — the signup form
  -- upper-cases whatever the user types before checking it).
  v_invite_code text := 'TEST-GROEP-2026';
  v_subject     text;
  v_html        text;
  v_name        text;
begin
  -- No key configured yet? Warn and leave the INSERT untouched.
  select decrypted_secret
    into v_api_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_api_key is null then
    raise warning
      'notify_admin_of_access_request: no Vault secret named resend_api_key; skipping email for request %',
      new.id;
    return new;
  end if;

  v_subject := 'New access request: '
               || public.access_request_html_escape(coalesce(new.name, 'Unknown'));

  v_html :=
      '<h2>New Handball Tracker access request</h2>'
    || '<p><strong>Name:</strong> '  || public.access_request_html_escape(coalesce(new.name, '-'))  || '</p>'
    || '<p><strong>Email:</strong> ' || public.access_request_html_escape(coalesce(new.email, '-')) || '</p>'
    || '<p><strong>Phone:</strong> ' || public.access_request_html_escape(coalesce(new.phone, '-')) || '</p>'
    || '<p><strong>Message:</strong><br>'
    || replace(public.access_request_html_escape(coalesce(new.message, '-')), E'\n', '<br>')
    || '</p>'
    || '<p><strong>Submitted:</strong> '
    || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC</p>'
    || '<hr><p>Review and approve it in the '
    || '<a href="https://app.handball-tracker.com/admin.html">admin panel</a>.</p>';

  -- Fire-and-forget: pg_net queues the request and returns a job id at once, so
  -- Resend being slow or down can never block or fail the subscriber's INSERT.
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_api_key,
                 'Content-Type',  'application/json'
               ),
    body    := jsonb_build_object(
                 'from',     v_from,
                 'to',       jsonb_build_array(v_to),
                 'reply_to', new.email,   -- reply goes straight to the subscriber
                 'subject',  v_subject,
                 'html',     v_html
               )
  );

  -- ---- 2) welcome email to the subscriber, with their invite code ----------
  -- Only if we actually have an address to send to. This is what used to be a
  -- manual "here's the code" email; it now goes out automatically on submit.
  if new.email is not null and btrim(new.email) <> '' then
    v_name := public.access_request_html_escape(coalesce(nullif(btrim(new.name), ''), 'there'));

    v_html :=
        '<h2>Welcome to Handball Tracker</h2>'
      || '<p>Hi ' || v_name || ',</p>'
      || '<p>Thanks for requesting access. Here is your invite code to create '
      || 'your account:</p>'
      || '<p style="font-size:22px;font-weight:bold;letter-spacing:2px;'
      || 'font-family:monospace">' || public.access_request_html_escape(v_invite_code) || '</p>'
      || '<p>To get started:</p>'
      || '<ol>'
      || '<li>Go to <a href="https://app.handball-tracker.com/">app.handball-tracker.com</a></li>'
      || '<li>Click <strong>Create Account</strong></li>'
      || '<li>Enter your email and choose a password</li>'
      || '<li>Enter the invite code above, then click <strong>Create Account</strong></li>'
      || '</ol>'
      || '<p>See you on the court!</p>'
      || '<hr><p style="color:#888;font-size:13px">Questions? Just reply to this '
      || 'email and it will reach us at info@handball-tracker.com.</p>';

    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_api_key,
                   'Content-Type',  'application/json'
                 ),
      body    := jsonb_build_object(
                   'from',     v_from,
                   'to',       jsonb_build_array(new.email),
                   'reply_to', v_to,       -- replies reach the support inbox
                   'subject',  'Your Handball Tracker access code',
                   'html',     v_html
                 )
    );
  end if;

  return new;
exception
  when others then
    -- Anything unexpected (Vault view missing, pg_net absent, bad JSON, ...)
    -- must not take the subscriber's request down with it.
    raise warning
      'notify_admin_of_access_request failed for request %: %',
      new.id, sqlerrm;
    return new;
end;
$$;

-- ---------------------------------------------------------------- trigger

drop trigger if exists trg_notify_admin_of_access_request on public.access_requests;
create trigger trg_notify_admin_of_access_request
  after insert on public.access_requests
  for each row
  execute function public.notify_admin_of_access_request();

-- ---------------------------------------------------------------- verification
--
-- Is the trigger registered?
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.access_requests'::regclass
--      and not tgisinternal;
--
-- Is the Vault secret present? (shows the name, not the value)
--   select name from vault.secrets where name = 'resend_api_key';
--
-- End-to-end test — inserts a fake request, which should trigger a real email:
--   insert into public.access_requests (name, email, phone, message, status)
--   values ('Test Subscriber', 'test@example.com', '0612345678',
--           'Just checking the email notification works.', 'pending');
--
-- Inspect pg_net's outbound queue / responses after a test insert:
--   select id, created, status_code, error_msg
--     from net._http_response
--    order by created desc
--    limit 5;
--
-- Remember to delete the test row afterwards:
--   delete from public.access_requests where email = 'test@example.com';
