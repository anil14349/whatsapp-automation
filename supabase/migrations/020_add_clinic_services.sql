-- Let each clinic choose which services it offers.
--
-- clinic_services ALREADY EXISTED, empty and read by nothing, with a narrower
-- shape: clinic_price/home_price, booking windows, no notion of where a service
-- is offered or whether it needs a doctor. CREATE TABLE IF NOT EXISTS silently
-- skipped it and the inserts then failed against the older columns, so this
-- extends the table in place instead.
--
-- service_types stays a GLOBAL catalogue keyed by code. Adding clinic_id there
-- would fork it per tenant and break every lookup that resolves by code.
--
-- This layers UNDER the existing clinics.enable_* flags, which were also in the
-- schema and read by nothing. Those stay as coarse master switches (does this
-- clinic do consultations at all) and this table decides which individual
-- services run within whatever the switches allow.

ALTER TABLE clinic_services
    ADD COLUMN IF NOT EXISTS offered_at_clinic   BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS offered_at_home     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS duration_minutes    INTEGER,
    ADD COLUMN IF NOT EXISTS requires_doctor     BOOLEAN NOT NULL DEFAULT TRUE,
    -- How many patients can hold the same slot. A doctor sees one at a time,
    -- but a diagnostic centre can run several draws at once, and without this
    -- every doctor-free service would silently be capacity one.
    ADD COLUMN IF NOT EXISTS concurrent_capacity INTEGER NOT NULL DEFAULT 1;

-- The primary key is a surrogate id, so nothing stopped a clinic having the
-- same service twice. ON CONFLICT below needs this to exist.
DO $$
BEGIN
    ALTER TABLE clinic_services
        ADD CONSTRAINT clinic_services_clinic_service_unique
        UNIQUE (clinic_id, service_type_id);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinic_services
        ADD CONSTRAINT clinic_services_somewhere
        CHECK (offered_at_clinic OR offered_at_home);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinic_services
        ADD CONSTRAINT clinic_services_capacity_sane
        CHECK (concurrent_capacity >= 1);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
    ALTER TABLE clinic_services
        ADD CONSTRAINT clinic_services_duration_sane
        CHECK (duration_minutes IS NULL OR duration_minutes > 0);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- The patient menu reads this on every greeting.
CREATE INDEX IF NOT EXISTS idx_clinic_services_enabled
    ON clinic_services (clinic_id, is_enabled, display_order);

-- Existing clinics keep doing exactly what they do today: consultation only.
-- Enabling the whole catalogue would put Imaging and Vaccine in front of
-- patients on a live WhatsApp number for services the clinic may not offer.
INSERT INTO clinic_services (
    clinic_id, service_type_id, is_enabled, offered_at_clinic, offered_at_home,
    requires_doctor, concurrent_capacity, display_order
)
SELECT c.id, s.id, TRUE, TRUE, COALESCE(c.enable_doctor_home_visits, FALSE), TRUE, 1, 0
FROM clinics c
CROSS JOIN service_types s
WHERE s.code = 'CONSULTATION'
ON CONFLICT (clinic_id, service_type_id) DO NOTHING;

-- Home collection is a live feature today, so preserve it where the clinic has
-- it switched on. Left disabled otherwise: opting in is safer than surprising
-- patients with a service the clinic cannot staff.
INSERT INTO clinic_services (
    clinic_id, service_type_id, is_enabled, offered_at_clinic, offered_at_home,
    requires_doctor, concurrent_capacity, display_order
)
SELECT c.id, s.id, COALESCE(c.enable_home_collection, FALSE), TRUE, TRUE, FALSE, 2, 1
FROM clinics c
CROSS JOIN service_types s
WHERE s.code = 'SAMPLE_COLLECTION'
ON CONFLICT (clinic_id, service_type_id) DO NOTHING;

-- The rest of the catalogue is recorded but switched off, so a clinic can turn
-- a service on from the portal without anyone writing SQL.
INSERT INTO clinic_services (
    clinic_id, service_type_id, is_enabled, offered_at_clinic, offered_at_home,
    requires_doctor, concurrent_capacity, display_order
)
SELECT
    c.id,
    s.id,
    FALSE,
    TRUE,
    s.default_home_price IS NOT NULL,
    s.category = 'CONSULTATION',
    1,
    10
FROM clinics c
CROSS JOIN service_types s
WHERE s.code NOT IN ('CONSULTATION', 'SAMPLE_COLLECTION')
ON CONFLICT (clinic_id, service_type_id) DO NOTHING;

-- Check it landed:
--   SELECT s.code, cs.is_enabled, cs.offered_at_home, cs.requires_doctor,
--          cs.concurrent_capacity, cs.clinic_price
--   FROM clinic_services cs
--   JOIN service_types s ON s.id = cs.service_type_id
--   ORDER BY cs.display_order;
