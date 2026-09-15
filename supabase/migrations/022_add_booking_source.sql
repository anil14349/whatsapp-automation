-- Record how an appointment reached the clinic.
--
-- Nothing distinguished a patient who booked themselves on WhatsApp from one
-- the front desk entered, so reception could not tell who had already been
-- messaged about their appointment and who had not. It also made it impossible
-- to say how much of the booking load the bot was actually carrying.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS booking_source TEXT NOT NULL DEFAULT 'WHATSAPP';

DO $$
BEGIN
    ALTER TABLE appointments
        ADD CONSTRAINT appointments_booking_source_known
        CHECK (booking_source IN ('WHATSAPP', 'WALK_IN', 'PORTAL', 'IMPORTED'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- Existing rows all came through the bot, which was the only way to book.
-- The default above already covers them; this is here so the intent is not
-- mistaken for an accident later.
UPDATE appointments SET booking_source = 'WHATSAPP' WHERE booking_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_source
    ON appointments (clinic_id, appointment_date, booking_source);
