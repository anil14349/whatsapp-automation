-- Run the reminder scheduler automatically.
--
-- Reminders, feedback surveys and appointment auto-completion only happen when
-- something POSTs to the scheduled-reminders function. Nothing did, so none of
-- them ever fired outside manual testing.
--
-- Before running this, set the two settings below. Keep them out of version
-- control: they are read from the database, not from this file.
--
--   ALTER DATABASE postgres SET app.scheduler_token = '<SCHEDULER_AUTH_TOKEN>';
--   ALTER DATABASE postgres SET app.functions_url  = 'https://<ref>.supabase.co/functions/v1';
--
-- Then reconnect so the settings take effect, and run this migration.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Without this the job still schedules, then fails every minute inside cron
-- where nobody looks. Refuse to create it rather than look healthy.
DO $$
DECLARE
    v_url   text := current_setting('app.functions_url', true);
    v_token text := current_setting('app.scheduler_token', true);
BEGIN
    IF v_url IS NULL OR v_url = '' OR v_token IS NULL OR v_token = '' THEN
        RAISE EXCEPTION
            'app.functions_url and app.scheduler_token must be set before scheduling. Run the two ALTER DATABASE statements at the top of this file, then RECONNECT (they do not apply to the current session) and re-run.';
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
        url := current_setting('app.functions_url') || '/scheduled-reminders',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.scheduler_token')
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
