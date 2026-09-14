-- Post-appointment feedback, mirroring the monolith's Feedback sheet.

CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    appointment_id VARCHAR(64) NOT NULL,
    patient_phone VARCHAR(20) NOT NULL,
    patient_name VARCHAR(200),
    doctor_name VARCHAR(200),
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    comments TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    CONSTRAINT feedback_status_check CHECK (status IN ('PENDING', 'RATED', 'COMPLETE', 'SKIPPED'))
);

-- One survey per appointment, so retries cannot spam the patient.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_appointment
    ON feedback (appointment_id);

CREATE INDEX IF NOT EXISTS idx_feedback_phone_status
    ON feedback (patient_phone, status);

CREATE INDEX IF NOT EXISTS idx_feedback_clinic_rating
    ON feedback (clinic_id, rating);

GRANT ALL ON feedback TO service_role;
