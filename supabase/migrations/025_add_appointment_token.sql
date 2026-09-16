-- A number the patient and the front desk can both say out loud.
--
-- "Your booking is APT_20260916_fbf5f1" is unusable across a counter. Clinics
-- here call people by a token, so each appointment gets one: sequential per
-- doctor per day, starting at 1.
--
-- The token is a stable handle, not a running position. It is never renumbered,
-- because a patient told they are token 7 must still be token 7 after somebody
-- else cancels. Cancellations leave gaps, which is what a paper token book does
-- too. Who is seen first is decided by appointment time, which is shown next to
-- it.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS token_number INTEGER;

-- Two people holding token 7 for the same doctor on the same day is the whole
-- failure, so the database refuses it rather than trusting the code.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_token_unique
    ON appointments (clinic_id, doctor_id, appointment_date, token_number)
    WHERE token_number IS NOT NULL;

/*
 * Assigned by the database so it cannot depend on which path booked the
 * appointment. There are two already, WhatsApp and the front desk, and a third
 * would otherwise have to remember.
 *
 * The advisory lock is held to the end of the transaction and keyed on the
 * doctor's day, so two bookings racing for the same doctor queue behind each
 * other while bookings for other doctors are unaffected.
 */
CREATE OR REPLACE FUNCTION set_appointment_token()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- A service with nobody assigned has no queue to stand in.
    IF NEW.doctor_id IS NULL OR NEW.token_number IS NOT NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            NEW.clinic_id::text || ':' || NEW.doctor_id::text || ':' || NEW.appointment_date::text,
            0
        )
    );

    SELECT COALESCE(MAX(token_number), 0) + 1
    INTO NEW.token_number
    FROM appointments
    WHERE clinic_id = NEW.clinic_id
      AND doctor_id = NEW.doctor_id
      AND appointment_date = NEW.appointment_date;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_assign_token ON appointments;

CREATE TRIGGER appointments_assign_token
    BEFORE INSERT ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION set_appointment_token();

-- Existing appointments predate this, so give them tokens in the order they
-- are actually seen rather than leaving today's queue half numbered.
WITH numbered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY clinic_id, doctor_id, appointment_date
               ORDER BY appointment_time, created_at
           ) AS seq
    FROM appointments
    WHERE token_number IS NULL
      AND doctor_id IS NOT NULL
)
UPDATE appointments a
SET token_number = numbered.seq
FROM numbered
WHERE a.id = numbered.id;
