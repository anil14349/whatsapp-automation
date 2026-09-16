-- The Meta app secret, so an inbound webhook can be proved rather than trusted.
--
-- The webhook has only ever been gated by a `?token=` in the query string.
-- That identifies which clinic is being addressed; it does not establish who
-- is calling. Anyone holding the token can post a message as any phone number
-- into that clinic, and because it rides in the URL it is written into proxy
-- logs and anywhere else request lines are kept.
--
-- Meta signs every delivery with HMAC-SHA256 of the raw body using the app
-- secret, which never travels with the request. Each clinic runs its own Meta
-- app, so the secret belongs beside the clinic's other WhatsApp credentials
-- rather than in one shared environment variable.
--
-- Enforcement follows the data: a clinic with a secret set must send a valid
-- signature, and one without keeps working on the token alone. That way this
-- can be rolled out one clinic at a time without a flag day that would drop
-- real patient messages. Set WHATSAPP_REQUIRE_SIGNATURE=true once every clinic
-- is configured, to refuse anything unsigned.

ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS whatsapp_app_secret TEXT;

COMMENT ON COLUMN clinics.whatsapp_app_secret IS
    'Meta app secret used to verify X-Hub-Signature-256 on inbound webhooks. Null means signature checking is off for this clinic.';
