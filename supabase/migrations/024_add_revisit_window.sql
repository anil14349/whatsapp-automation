-- A follow-up soon after a visit is the same visit continuing.
--
-- Clinics here commonly let a patient return within a short window without
-- paying again, but nothing recorded how long that window is or which
-- appointments fall inside it, so the front desk had to remember.
--
-- Zero means the clinic does not offer one, which is why that is the default:
-- a clinic that has not set this should not suddenly start marking visits free.

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS revisit_window_days INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE clinics
        ADD CONSTRAINT clinics_revisit_window_sane
        -- A year is already absurd for a follow-up; beyond that it is a typo.
        CHECK (revisit_window_days BETWEEN 0 AND 365);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- Decided when the appointment is booked rather than worked out later, because
-- the window can change and a visit already booked as a revisit should stay one.
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS is_revisit BOOLEAN NOT NULL DEFAULT false;

-- The revisit check looks for this patient's last completed visit to this
-- doctor, which is otherwise a scan of every appointment the clinic has.
CREATE INDEX IF NOT EXISTS appointments_revisit_lookup
    ON appointments (clinic_id, patient_phone, doctor_id, appointment_date DESC);
