-- Which collector a home visit belongs to.
--
-- Every collector could see every home visit for the clinic, and any of them
-- could mark any visit collected. That is workable with one collector and
-- wrong with two: the second one closes the first one's round.
--
-- Nullable on purpose. A visit booked when every collector is at their daily
-- limit, or before any collector exists, must still be bookable - it sits
-- unassigned and is claimed by whoever closes it, rather than vanishing.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS collector_id UUID REFERENCES sample_collectors(id) ON DELETE SET NULL;

-- The collector's own list is "mine today, plus anything unclaimed".
CREATE INDEX IF NOT EXISTS idx_appointments_collector_date
    ON appointments (clinic_id, collector_id, appointment_date)
    WHERE status = 'CONFIRMED';
