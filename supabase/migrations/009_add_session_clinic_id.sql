-- ============================================================
-- Add clinic_id to whatsapp_sessions
-- ============================================================
-- whatsapp_sessions was created in 001, before the multi-clinic model in 002,
-- so it never gained a clinic_id column. message-processor.ts filters and
-- inserts on clinic_id, so every session lookup failed with
-- "42703: column whatsapp_sessions.clinic_id does not exist" and the webhook
-- silently fell back to an in-memory session that was never persisted.

ALTER TABLE whatsapp_sessions
    ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

UPDATE whatsapp_sessions s
SET clinic_id = c.id
FROM clinics c
WHERE s.clinic_id IS NULL
  AND c.clinic_code = 'DEFAULT_CLINIC';

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_clinic
    ON whatsapp_sessions(clinic_id);

-- A phone can hold one session per clinic, not one globally.
ALTER TABLE whatsapp_sessions
    DROP CONSTRAINT IF EXISTS whatsapp_sessions_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone_clinic
    ON whatsapp_sessions(phone, clinic_id);
