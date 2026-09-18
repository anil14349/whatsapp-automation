-- A collector is identified by their phone number and nothing else.
--
-- `getRoleByPhoneForClinic` looks the number up in `sample_collectors`, and if
-- it matches an active row the sender is a collector from that moment on. No
-- PIN, no second factor, no session expiry. Doctors have never worked this
-- way: a doctor matched by phone lands in DOCTOR_LOGIN and must clear a bcrypt
-- `doctors.pin_hash` before the menu opens.
--
-- It mattered less when the collector flow did little. The round now lists,
-- for every home visit that day, the patient's name, their appointment time
-- and their home address. A spoofed or recycled number gets a list of who is
-- home and when.
--
-- Nullable on purpose. Collectors already exist with no PIN, and refusing
-- everyone with a null hash would lock out whoever is working that day. A null
-- hash means "set one now", handled in COLLECTOR_SET_PIN, rather than "let
-- them in".

ALTER TABLE sample_collectors
    ADD COLUMN IF NOT EXISTS pin_hash TEXT;

COMMENT ON COLUMN sample_collectors.pin_hash IS
    'bcrypt hash of the collector''s WhatsApp PIN; NULL means they must set one before seeing a round.';

-- A session already sitting in COLLECTOR_MENU would walk straight past the new
-- gate, because the gate only stands in front of the states before it. Sending
-- them back to COLLECTOR_LOGIN costs one PIN entry and closes the window.
UPDATE whatsapp_sessions
SET state = 'COLLECTOR_LOGIN', data = '{}'::jsonb
WHERE role = 'HOME_COLLECTION_PERSON'
  AND state IN ('COLLECTOR_MENU', 'COLLECTOR_CONFIRM');

