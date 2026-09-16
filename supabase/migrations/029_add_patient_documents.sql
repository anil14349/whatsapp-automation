-- Getting a report back to the patient.
--
-- The clinic can already take a home sample collection and mark the visit
-- complete, and then the trail stops: there is no way to send the patient
-- anything. A lab report or a prescription goes out by hand, on paper or from
-- somebody's personal WhatsApp, which is both slower than the booking it
-- follows and untraceable afterwards.
--
-- The file itself lives in storage. This is the record of what was sent, to
-- whom, and whether it arrived — a send that Meta refused has to be visible to
-- the desk, not swallowed, because the patient is waiting for a result.

CREATE TABLE IF NOT EXISTS patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

    -- Appointments are keyed by TEXT here, and a document need not belong to
    -- one: a walk-in collection can be reported against the phone alone.
    appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,

    patient_phone VARCHAR(20) NOT NULL,
    patient_name VARCHAR(255),

    kind VARCHAR(20) NOT NULL DEFAULT 'REPORT',
    file_name VARCHAR(255) NOT NULL,

    -- Built by the server from the clinic and a fresh id, never from anything
    -- the uploader sent, so a crafted filename cannot reach another clinic.
    storage_path TEXT NOT NULL UNIQUE,

    size_bytes INTEGER,
    content_type VARCHAR(100),

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    message_id VARCHAR(255),
    error_message TEXT,

    uploaded_by VARCHAR(255),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    ALTER TABLE patient_documents
        ADD CONSTRAINT patient_documents_kind_known
        CHECK (kind IN ('REPORT', 'PRESCRIPTION', 'INVOICE', 'OTHER'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE patient_documents
        ADD CONSTRAINT patient_documents_status_known
        CHECK (status IN ('PENDING', 'SENT', 'FAILED'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- "What have we sent this patient" is the question the desk asks, and it asks
-- it by phone number far more often than by appointment.
CREATE INDEX IF NOT EXISTS patient_documents_by_patient
    ON patient_documents (clinic_id, patient_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_documents_by_appointment
    ON patient_documents (clinic_id, appointment_id)
    WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN patient_documents.storage_path IS
    'Object key in the patient-documents bucket. Server-generated, clinic-prefixed.';
