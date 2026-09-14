-- ============================================================
-- Remember each patient's language choice
-- ============================================================
-- The Apps Script version skipped the language prompt for returning
-- patients by reading it from their record. The edge functions had
-- nowhere to store it, so every greeting restarted language selection.

ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'EN';
