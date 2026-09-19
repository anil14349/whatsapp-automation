-- Whether the patient who is next has been told they are next.
--
-- The notice is sent free-form, which Meta only accepts within 24 hours of the
-- patient's own last message. Someone who booked last week and has not written
-- since cannot be reached at all, and there is no error to see: the send is
-- simply refused. Without a record of that, the front desk has no way to know
-- which of the people in the waiting room heard anything, and the ones it
-- silently skips are exactly the ones least likely to be watching a phone.
--
-- So this is not a delivery log. It is the one fact the desk needs: told, or
-- not told and therefore worth calling by name.
--
-- Null means nobody has told them. That covers both "not their turn yet" and
-- "we tried and Meta refused", which are the same thing from the desk's side
-- of the counter — walk over and say it out loud.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS next_up_notified_at TIMESTAMP;

-- The board reads today's appointments for one clinic, ordered by time, and
-- reads them again every time the page is opened. Existing indexes cover
-- status and the doctor's day, but not the clinic's.
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_day
    ON appointments (clinic_id, appointment_date, appointment_time);
