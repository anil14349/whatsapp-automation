-- Tenant-scope patients, and move staff identity out of environment variables.
--
-- Patients were globally unique by phone, so two clinics sharing a patient
-- shared one row: name, age, blood group and allergies collected by one clinic
-- were readable and overwritable by the other.

ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

-- Existing rows belong to the clinic that has been running until now.
UPDATE patients
SET clinic_id = (SELECT id FROM clinics WHERE clinic_code = 'DEFAULT_CLINIC')
WHERE clinic_id IS NULL;

ALTER TABLE patients
    ALTER COLUMN clinic_id SET NOT NULL;

-- A phone is unique per clinic, not globally.
ALTER TABLE patients
    DROP CONSTRAINT IF EXISTS patients_phone_key;

DROP INDEX IF EXISTS patients_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_clinic_phone
    ON patients (clinic_id, phone);

-- Conversation history has to be separable per clinic too.
ALTER TABLE whatsapp_log
    ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_whatsapp_log_clinic
    ON whatsapp_log (clinic_id, created_at DESC);

-- Collectors were a global env list shared by every clinic.
CREATE TABLE IF NOT EXISTS sample_collectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    max_collections_per_day INT NOT NULL DEFAULT 8,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_collectors_clinic_phone
    ON sample_collectors (clinic_id, phone);

CREATE INDEX IF NOT EXISTS idx_sample_collectors_active
    ON sample_collectors (clinic_id, is_active);

GRANT ALL ON sample_collectors TO service_role;

-- Doctors are matched by phone within a clinic when routing inbound messages.
CREATE INDEX IF NOT EXISTS idx_doctors_clinic_phone
    ON doctors (clinic_id, phone);
