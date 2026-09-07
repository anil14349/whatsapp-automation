-- ============================================================
-- Inbound WhatsApp message idempotency.
--
-- The Apps Script version handled this with a 4-key CacheService dance
-- (WA_PROCESSED_*, WA_PROCESSING_*, WA_OUTBOUND_*, plus a LockService
-- retry loop around it — see the doPost comment in src/Webhook.gs) to
-- work around CacheService not having an atomic "insert if absent"
-- primitive. `INSERT ... ON CONFLICT DO NOTHING` gives us exactly that
-- primitive directly, so the whole dance collapses to one statement.
-- ============================================================

create table whatsapp_message_dedup (
    message_id text primary key,
    processed_at timestamptz not null default now()
);

comment on table whatsapp_message_dedup is 'One row per WhatsApp message_id ever processed. INSERT ... ON CONFLICT DO NOTHING RETURNING is the idempotency check — see lib/whatsapp/dedup.ts.';

alter table whatsapp_message_dedup enable row level security;
