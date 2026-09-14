-- Schema the api/* edge functions expect but that was never created.

-- Doctors authenticate to the portal with a bcrypt-hashed PIN.
ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS pin_hash TEXT;

COMMENT ON COLUMN doctors.pin_hash IS 'bcrypt hash of the portal PIN; NULL means portal login disabled';

-- doctors-auth-me returns clinic location in the profile payload.
ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS location TEXT;

CREATE TABLE IF NOT EXISTS receptionists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    password_hash TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT receptionists_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'))
);

-- Login looks up by email within a clinic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receptionists_clinic_email
    ON receptionists (clinic_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_receptionists_status
    ON receptionists (clinic_id, status);

GRANT ALL ON receptionists TO service_role;

-- Doctor login looks up by email within a clinic too.
CREATE INDEX IF NOT EXISTS idx_doctors_clinic_email
    ON doctors (clinic_id, lower(email));

-- CHECK (expires_at > NOW()) is re-evaluated on UPDATE, so once a token
-- expires the row can never be modified again - including marking it used.
-- Expiry is enforced in application code instead.
ALTER TABLE password_reset_tokens
    DROP CONSTRAINT IF EXISTS fk_password_reset_expires;
