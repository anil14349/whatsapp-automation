-- Per-clinic WhatsApp credentials so each clinic can run its own Meta app
-- and its own WhatsApp Business Account.
--
-- Routing works like this:
--   GET  (Meta subscription handshake) -> matched by whatsapp_verify_token
--   POST (inbound messages)            -> authorised by whatsapp_webhook_token,
--                                         clinic resolved from phone_number_id
--   outbound                           -> sent with that clinic's own token

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT,
    ADD COLUMN IF NOT EXISTS whatsapp_verify_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS whatsapp_webhook_token VARCHAR(255);

COMMENT ON COLUMN clinics.whatsapp_phone_number_id IS 'Meta phone_number_id; inbound messages are routed to this clinic by matching it';
COMMENT ON COLUMN clinics.whatsapp_access_token IS 'Clinic-owned Meta access token used to send replies. Service role only.';
COMMENT ON COLUMN clinics.whatsapp_verify_token IS 'Clinic-specific hub.verify_token for the webhook subscription handshake';
COMMENT ON COLUMN clinics.whatsapp_webhook_token IS 'Clinic-specific ?token= value authorising inbound POSTs';

-- One clinic per WhatsApp number, and the routing lookup must be fast.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_whatsapp_phone_number_id
    ON clinics (whatsapp_phone_number_id)
    WHERE whatsapp_phone_number_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_whatsapp_verify_token
    ON clinics (whatsapp_verify_token)
    WHERE whatsapp_verify_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_whatsapp_webhook_token
    ON clinics (whatsapp_webhook_token)
    WHERE whatsapp_webhook_token IS NOT NULL;

-- These columns hold credentials; make sure no anon/authenticated grant exists.
REVOKE ALL ON clinics FROM anon, authenticated;
GRANT ALL ON clinics TO service_role;
