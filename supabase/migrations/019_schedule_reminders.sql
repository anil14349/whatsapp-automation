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
