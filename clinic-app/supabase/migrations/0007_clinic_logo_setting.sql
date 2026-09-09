-- Adds a clinic-logo setting for the shareable appointment receipt card
-- (see lib/whatsapp/receipt.tsx). Empty by default: the card renders
-- fine with no logo (just the clinic name text) until a clinic sets
-- this to a real, publicly reachable image URL — next/og's
-- ImageResponse (Satori under the hood) needs to fetch it, so a local
-- file path or an auth-gated URL won't render.
insert into settings (key, value) values
    ('CLINIC_LOGO_URL', '')
on conflict (key) do nothing;
