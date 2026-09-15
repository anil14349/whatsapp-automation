-- Staff provisioning: someone has to be able to create doctors and
-- receptionists. Until now every staff row had to be inserted by hand.

CREATE TABLE IF NOT EXISTS clinic_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL clinic_id means a platform-wide ADMIN rather than a clinic owner.
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'CLINIC_OWNER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT clinic_admins_role_check CHECK (role IN ('CLINIC_OWNER', 'ADMIN')),
    CONSTRAINT clinic_admins_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    -- A platform ADMIN has no clinic; a CLINIC_OWNER must have one.
    CONSTRAINT clinic_admins_scope_check CHECK (
        (role = 'ADMIN' AND clinic_id IS NULL) OR
        (role = 'CLINIC_OWNER' AND clinic_id IS NOT NULL)
    )
);

-- Login is by email, unique per clinic and unique among platform admins.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_admins_clinic_email
    ON clinic_admins (clinic_id, lower(email))
    WHERE clinic_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_admins_platform_email
    ON clinic_admins (lower(email))
    WHERE clinic_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clinic_admins_status
    ON clinic_admins (clinic_id, status);

-- Sample collectors are provisioned through the same staff endpoint, so they
-- need the contact columns the API writes.
ALTER TABLE sample_collectors
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Only the service role reaches these tables; the API layer does the checks.
REVOKE ALL ON clinic_admins FROM anon, authenticated;
GRANT ALL ON clinic_admins TO service_role;

-- Reset tokens already cover doctors and receptionists; admins reuse the table.
COMMENT ON COLUMN password_reset_tokens.user_type IS
    'doctor | receptionist | admin';
