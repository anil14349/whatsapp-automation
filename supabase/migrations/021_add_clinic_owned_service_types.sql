-- Let a clinic add services of its own.
--
-- service_types was a shared catalogue. A clinic wanting "Full Body Scan - Gold
-- Package" had no way to add it without someone writing SQL, and naming it for
-- every other clinic too.
--
-- clinic_id NULL keeps a row global, as all existing rows are. A clinic_id
-- makes it private to that clinic. Everything that reads service_types directly
-- must therefore filter on `clinic_id IS NULL OR clinic_id = <clinic>`, or one
-- clinic will see another's services.

ALTER TABLE service_types
    ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

-- `code` was globally unique, so two clinics could never both have DENTAL.
-- Uniqueness now applies within a scope instead: once across the shared
-- catalogue, and once per clinic for private ones.
ALTER TABLE service_types DROP CONSTRAINT IF EXISTS service_types_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS service_types_global_code_unique
    ON service_types (code)
    WHERE clinic_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_types_clinic_code_unique
    ON service_types (clinic_id, code)
    WHERE clinic_id IS NOT NULL;

-- The services page reads the catalogue a clinic may use on every load.
CREATE INDEX IF NOT EXISTS idx_service_types_scope
    ON service_types (clinic_id, is_active);

-- Check it landed:
--   SELECT code, name, clinic_id IS NULL AS shared FROM service_types ORDER BY shared DESC, code;
