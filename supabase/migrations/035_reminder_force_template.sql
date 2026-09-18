-- A reminder is not delivered just because Meta accepted it.
--
-- The scheduler sends the reminder as an interactive message with Cancel and
-- Reschedule buttons. Meta accepts that call, returns a message id, and only
-- afterwards reports 131047 on the status webhook - the patient last wrote to
-- us more than 24 hours ago, which is true of almost every reminder. The row
-- was already marked SENT by then, so nothing retried and nobody knew.
--
-- The template fallback in sendProactive was written for a synchronous refusal
-- and never ran for these. When the late failure arrives the reminder goes back
-- to PENDING with this flag set, and the next scheduler pass sends the approved
-- template instead of repeating the same doomed free-form message.

ALTER TABLE appointment_reminders
    ADD COLUMN IF NOT EXISTS force_template BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN appointment_reminders.force_template IS
    'Free-form already failed for this recipient; send the template directly.';

-- The status webhook arrives with Meta''s message id and nothing else to match
-- on, and it arrives for every message the clinic sends, not just reminders.
CREATE INDEX IF NOT EXISTS appointment_reminders_by_message
    ON appointment_reminders (message_id)
    WHERE message_id IS NOT NULL;
