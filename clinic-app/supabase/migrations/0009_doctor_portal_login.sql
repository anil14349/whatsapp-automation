-- Adds web-portal login credentials to doctors, mirroring admin_users'
-- email/password_hash columns rather than a separate table — every
-- doctor is already a single first-class row, and the WhatsApp doctor
-- flow already keys off doctors.id, so this just adds an optional
-- second way in (a browser) alongside the existing WhatsApp one.
-- Both columns are nullable: an existing doctor has no web credentials
-- until a clinic admin runs scripts/set-doctor-password.mjs for them.
alter table doctors add column email text;
alter table doctors add column password_hash text;

create unique index doctors_email_idx on doctors (email) where email is not null;
