-- Let each clinic choose which services it offers.
--
-- service_types is a GLOBAL catalogue keyed by code (CONSULTATION, BLOOD_TEST,
-- ...). Adding clinic_id to it would fork the catalogue per tenant and break
-- every lookup that resolves a service by code, so per-clinic choices live in
-- a join table instead. The default_* columns on service_types become the
-- fallback when a clinic does not override them.
--
-- This layers UNDER the existing clinics.enable_* flags, which were already in
-- the schema and read by nothing. Those stay as coarse master switches
-- (does this clinic do consultations at all) and this table decides which
-- individual services are offered within whatever the switches allow.

CREATE TABLE IF NOT EXISTS clinic_services (
    clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    service_type_id   UUID NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,

    is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,

    -- A service can be offered in the clinic, at home, or both. Imaging, for
    -- example, cannot travel.
    offered_at_clinic BOOLEAN NOT NULL DEFAULT TRUE,
    offered_at_home   BOOLEAN NOT NULL DEFAULT FALSE,

    -- NULL means inherit the catalogue default rather than "free".
    price             NUMERIC(10, 2),
    home_price        NUMERIC(10, 2),
    duration_minutes  INTEGER,

    -- Diagnostics usually do not need a doctor chosen, which changes the
    -- booking flow, not just the menu.
    requires_doctor   BOOLEAN NOT NULL DEFAULT TRUE,

    -- How many patients can hold the same slot. A doctor sees one patient at a
    -- time, but a diagnostic centre can run several draws at once, and without
    -- this every doctor-free service would silently be capacity one.
    concurrent_capacity INTEGER NOT NULL DEFAULT 1,

    display_order     INTEGER NOT NULL DEFAULT 0,

    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (clinic_id, service_type_id),

    CONSTRAINT clinic_services_somewhere CHECK (offered_at_clinic OR offered_at_home),
    CONSTRAINT clinic_services_price_sane CHECK (price IS NULL OR price >= 0),
    CONSTRAINT clinic_services_home_price_sane CHECK (home_price IS NULL OR home_price >= 0),
    CONSTRAINT clinic_services_duration_sane CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    CONSTRAINT clinic_services_capacity_sane CHECK (concurrent_capacity >= 1)
);

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
