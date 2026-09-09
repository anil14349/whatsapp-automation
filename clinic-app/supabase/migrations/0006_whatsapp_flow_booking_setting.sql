-- Adds the on/off switch for native WhatsApp Flows booking (see
-- lib/whatsapp/flowBooking.ts, app/api/whatsapp/flow/route.ts). Defaults
-- to FALSE: this needs a Flow published in Meta's Flow Builder plus a
-- keypair configured (WHATSAPP_FLOW_ID / WHATSAPP_FLOW_PRIVATE_KEY env
-- vars) before it can work, so an upgrade must never silently start
-- sending flow-trigger messages a clinic hasn't set up yet — the bot
-- keeps using the existing list/button booking flow until this is
-- turned on deliberately from /admin/settings.
insert into settings (key, value) values
    ('ENABLE_WHATSAPP_FLOW_BOOKING', 'FALSE')
on conflict (key) do nothing;
