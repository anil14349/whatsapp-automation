-- How many WhatsApp sends sendDoctorBroadcast (lib/broadcast.ts) fires in
-- parallel per batch, instead of fully sequentially, when a doctor or
-- admin broadcasts to every patient confirmed on a given date. A large
-- confirmed-appointment list sent one-at-a-time can exceed the request
-- lifetime of whichever caller invoked it (the WhatsApp webhook route or
-- the admin appointments page's server action) — see CONFIGURATION.md's
-- "Doctor broadcast timeouts" section. Defaults to 5, matching the
-- DEFAULT_SEND_CONCURRENCY constant lib/broadcast.ts falls back to if
-- this row is ever missing or unparseable.
insert into settings (key, value) values
    ('BROADCAST_SEND_CONCURRENCY', '5')
on conflict (key) do nothing;
