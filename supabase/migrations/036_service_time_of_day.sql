-- A service can keep narrower hours than the building.
--
-- Slots for a doctor-free service come from the premises hours, so once the
-- real opening times were set Sample Collection offered 102 slots on a Monday,
-- the last at 23:20. A home blood draw could be booked for twenty past eleven
-- at night. `clinic_services` had booking-window columns but nothing that
-- narrows the time of day.
--
-- NULL on either column means "follow the premises hours", which is what every
-- existing row does today.

ALTER TABLE clinic_services
    ADD COLUMN IF NOT EXISTS available_from TIME,
    ADD COLUMN IF NOT EXISTS available_to TIME;

COMMENT ON COLUMN clinic_services.available_from IS
    'Earliest start time this service may be booked for; NULL follows clinic hours.';
COMMENT ON COLUMN clinic_services.available_to IS
    'Latest time this service may still be running; NULL follows clinic hours.';

-- Lab work at Wellsun runs 07:00-19:00, not to 23:30 with the building.
UPDATE clinic_services cs
SET available_from = '07:00', available_to = '19:00'
FROM service_types st
WHERE st.id = cs.service_type_id
  AND st.category IN ('DIAGNOSTIC', 'IMAGING')
  AND cs.available_from IS NULL
  AND cs.available_to IS NULL;
