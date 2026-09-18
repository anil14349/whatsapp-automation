-- Run the reminder scheduler automatically.
--
-- Reminders, feedback surveys and appointment auto-completion only happen when
-- something POSTs to the scheduled-reminders function. Nothing did, so none of
-- them ever fired outside manual testing.
--
-- The token and URL live in Vault, NOT in database settings: Supabase's hosted
-- Postgres refuses `ALTER DATABASE ... SET app.*` with 42501, because the
-- postgres role is not superuser. Vault also keeps this migration portable
-- across projects, which a hardcoded project ref would not be.
--
-- Create both before running this, and keep them out of version control:
--
--   SELECT vault.create_secret('<SCHEDULER_AUTH_TOKEN>', 'scheduler_token');
--   SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_url');
--
-- To rotate the token later:
--   SELECT vault.update_secret(
--       (SELECT id FROM vault.secrets WHERE name = 'scheduler_token'),
--       '<NEW TOKEN>');

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Without these the job still schedules, then fails every minute inside cron
-- where nobody looks. Refuse to create it rather than look healthy.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'scheduler_token' AND coalesce(decrypted_secret, '') <> ''
    ) THEN
        -- array_append, not `|| 'literal'`: an untyped literal lets Postgres
        -- read `||` as array-to-array and try to cast it, so this guard died
        -- with "malformed array literal" instead of naming what was missing.
        v_missing := array_append(v_missing, 'scheduler_token');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'functions_url' AND coalesce(decrypted_secret, '') <> ''
    ) THEN
        v_missing := array_append(v_missing, 'functions_url');
    END IF;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION
            'Missing Vault secret(s): %. Create them with vault.create_secret(''<value>'', ''<name>'') before scheduling.',
            array_to_string(v_missing, ', ');
    END IF;
END;
$$;

-- Recreating the job is safe to re-run; unschedule first if it exists.
DO $$
BEGIN
    PERFORM cron.unschedule('run-scheduled-reminders');
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
    'run-scheduled-reminders',
    '* * * * *',
    $$
    SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'functions_url')
               || '/scheduled-reminders',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' ||
                (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'scheduler_token')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
    $$
);

-- Check it is running:
--   SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'run-scheduled-reminders';
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'run-scheduled-reminders')
--     ORDER BY start_time DESC LIMIT 5;
--
-- job_run_details showing "succeeded" is NOT proof the reminder was sent.
-- net.http_post only queues the request and returns an id, so cron reports
-- success even when the call later 401s or never leaves the box. The delivered
-- status code is here:
--   SELECT id, status_code, content, created FROM net._http_response
--     ORDER BY created DESC LIMIT 5;
