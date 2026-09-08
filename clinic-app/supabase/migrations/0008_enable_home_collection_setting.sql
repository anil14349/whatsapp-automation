-- Adds an explicit on/off switch for the Home Sample Collection patient
-- flow (see lib/whatsapp/patientFlow.ts, lib/homeCollection.ts). Until
-- now the only gate was HOSPITAL_LATITUDE/LONGITUDE being unset, which
-- bounced a patient back with an apologetic message *after* they'd
-- already tapped the menu option rather than not showing the option at
-- all. Defaults TRUE so an existing deployment that already has
-- HOSPITAL_LATITUDE/LONGITUDE configured keeps working exactly as
-- before — a hospital without diagnostics/lab collection turns this
-- off explicitly instead.
insert into settings (key, value) values
    ('ENABLE_HOME_COLLECTION', 'TRUE')
on conflict (key) do nothing;
