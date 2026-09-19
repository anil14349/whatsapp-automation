-- Whether a doctor takes appointments at all, or only sees who walks in.
--
-- The only way to express "do not offer this one on WhatsApp" was
-- availability_status = OFFLINE, which is the wrong field: that one answers
-- "where is this doctor right now", and gets changed from their phone several
-- times a day. Using it for a standing arrangement meant the doctor was still
-- listed to patients, still pickable, and then had no slots on any date -- a
-- dead end a real patient hit twice before backing out.
--
-- Sits beside can_do_home_visits, which is the same kind of fact: what this
-- doctor does, as opposed to what they are doing at this minute.
--
-- Defaults to true because every doctor already in the table was bookable, and
-- a migration should not quietly stop a clinic taking appointments.

ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS takes_online_appointments BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN doctors.takes_online_appointments IS
    'False means walk-ins only: not offered on WhatsApp, still bookable at the front desk.';
