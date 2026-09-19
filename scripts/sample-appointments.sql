-- Sample appointments for checking the appointments screen.
--
-- Inserted directly rather than through the booking endpoint, so none of the
-- notification paths run: no reminders are created, no doctor is told, no
-- collector is assigned.
--
-- Every row is named "ZZ Sample ..." and uses 9100000000xx, so they are easy
-- to find and delete. Dated ahead of today so they cannot mix with real work
-- and the auto-complete sweep (CONFIRMED before today) leaves them alone.

BEGIN;

INSERT INTO appointments (
    id, clinic_id, doctor_id, service_type_id, patient_name, patient_phone,
    appointment_date, appointment_time, status, location_type, booking_source,
    token_number, is_revisit, preferred_language, completed_at
) VALUES
-- Booked, blue
('APT_SAMPLE_BOOKED', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 '18bec8c5-86ed-4c85-ace5-989295a38ed6', '5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a',
 'ZZ Sample Booked', '910000000001', '2026-09-22', '09:00', 'CONFIRMED',
 'CLINIC', 'WHATSAPP', 1, false, 'EN', NULL),

-- Seen, green, and a returning patient so the revisit pill shows
('APT_SAMPLE_SEEN', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 '18bec8c5-86ed-4c85-ace5-989295a38ed6', '5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a',
 'ZZ Sample Seen', '910000000002', '2026-09-22', '09:30', 'COMPLETED',
 'CLINIC', 'WALK_IN', 2, true, 'EN', now()),

-- Did not turn up, slate
('APT_SAMPLE_NOSHOW', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 '18bec8c5-86ed-4c85-ace5-989295a38ed6', '5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a',
 'ZZ Sample No Show', '910000000003', '2026-09-22', '10:00', 'NO_SHOW',
 'CLINIC', 'WHATSAPP', 3, false, 'EN', NULL),

-- Cancelled, red
('APT_SAMPLE_CANCELLED', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 '18bec8c5-86ed-4c85-ace5-989295a38ed6', '5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a',
 'ZZ Sample Cancelled', '910000000004', '2026-09-22', '10:30', 'CANCELLED',
 'CLINIC', 'WHATSAPP', 4, false, 'EN', NULL),

-- Moved: the status the schema declares and nothing writes, so this is the
-- only way to see that it no longer falls through to lower-case grey.
('APT_SAMPLE_MOVED', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 '18bec8c5-86ed-4c85-ace5-989295a38ed6', '5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a',
 'ZZ Sample Moved', '910000000005', '2026-09-22', '11:00', 'RESCHEDULED',
 'CLINIC', 'WHATSAPP', 5, false, 'EN', NULL),

-- A home visit with no doctor, which also brings up the clinic/home filter row
('APT_SAMPLE_HOME', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 NULL, 'cce81cc9-2f84-4fe2-821f-074240d2609a',
 'ZZ Sample Home Visit', '910000000006', '2026-09-22', '07:00', 'CONFIRMED',
 'HOME', 'WHATSAPP', NULL, false, 'EN', NULL),

-- A long name and a Hindi speaker, to see how the columns hold up
('APT_SAMPLE_LONGNAME', '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
 '18bec8c5-86ed-4c85-ace5-989295a38ed6', '5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a',
 'ZZ Sample Venkataramanan Subramaniam', '910000000007', '2026-09-22', '11:30',
 'CONFIRMED', 'CLINIC', 'WALK_IN', 6, false, 'HI', NULL);

-- The survey sweep messages any COMPLETED appointment from the last 7 days
-- that has no feedback row, every minute until it sends. A row here is what
-- stops the sample patient being written to.
--
-- Dated with its own appointment and left without a comment on purpose: at
-- today's date it joined the real ratings on the Summary, and a made-up
-- remark appeared under "What patients said".
INSERT INTO feedback (id, clinic_id, appointment_id, patient_phone, rating, comments, status, submitted_at)
VALUES (gen_random_uuid(), '402ae46c-56ed-40b0-a4b0-df63d6b43acc',
        'APT_SAMPLE_SEEN', '910000000002', 5, NULL,
        'COMPLETE', '2026-09-22 09:45:00+00');

COMMIT;
