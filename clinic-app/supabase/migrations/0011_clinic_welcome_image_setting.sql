-- Optional image sent alongside the greeting (lib/whatsapp/router.ts's
-- handleGreeting) on a patient's first "Hi" and on a returning patient's
-- "Hi" straight to the main menu. Same convention as CLINIC_LOGO_URL
-- (migration 0007): blank means "no welcome image", and any publicly
-- reachable http(s) image URL works — WhatsApp fetches it directly by
-- link, no upload step needed (see sendWhatsAppImageByUrl in
-- lib/whatsapp/send.ts).
insert into settings (key, value) values
    ('CLINIC_WELCOME_IMAGE_URL', '')
on conflict (key) do nothing;
