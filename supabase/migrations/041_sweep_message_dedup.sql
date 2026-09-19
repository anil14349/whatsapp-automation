-- Actually expire the rows message_dedup says expire.
--
-- 001 gives the table an expires_at, defaults it to 48 hours, indexes it, and
-- comments it "prevents table from growing indefinitely". Nothing has ever
-- deleted a row. The column is a claim the schema makes and does not keep, so
-- the table grows by one row per inbound WhatsApp message, forever.
--
-- Deleting in the database rather than from an edge function: there is nothing
-- to decide, no message to send, and no reason to spend a function invocation
-- and a network hop on a DELETE. It also means a sweep cannot be lost to a
-- deploy that drops the --no-verify-jwt flag.
--
-- Hourly, not every minute. Nothing depends on a row disappearing promptly --
-- the point is that it disappears at all -- and the reminder job already runs
-- every minute on the same instance.
--
-- Safe on a row still marked 'processing'. Past its expiry the work is long
-- finished or long abandoned, and the webhook only skips a message whose row
-- says 'completed', so a stuck row was never protecting anything.

DO $$
BEGIN
    PERFORM cron.unschedule('sweep-message-dedup');
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
    'sweep-message-dedup',
    '7 * * * *',
    $$
    DELETE FROM message_dedup
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW();
    $$
);

-- A row written before this migration by a path that set expires_at to null
-- would never be swept, so give those the same 48 hours from creation.
UPDATE message_dedup
SET expires_at = created_at + INTERVAL '48 hours'
WHERE expires_at IS NULL;

-- Check it is running:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sweep-message-dedup';
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sweep-message-dedup')
--     ORDER BY start_time DESC LIMIT 5;
