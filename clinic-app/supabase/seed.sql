-- ============================================================
-- Local development seed data.
--
-- Run automatically by `supabase db reset` (and therefore by
-- `npm run db:reset`) after every migration in supabase/migrations/ has
-- applied. Purely for local development/demo convenience — never run
-- against a real clinic's production database, since it inserts
-- made-up patients/appointments.
--
-- No Google Calendar setup needed — booking availability is computed
-- directly from doctor_availability/doctor_leaves/appointments (see
-- lib/scheduling/slots.ts), so this seed data is enough on its own to
-- fully exercise live booking through the WhatsApp bot immediately
-- after `npm run db:reset`, not just to make the admin UI look
-- populated.
--
-- No admin_users row is seeded here — password hashing needs Node's
-- scrypt, which plain SQL can't produce a valid hash for inline. Run
-- `npm run create-admin -- --email you@clinic.com --password '...'`
-- after seeding, same as a real deployment.
-- ============================================================

insert into doctors (id, doctor_code, name, clinic_name, whatsapp_phone, appointment_duration_minutes, active, specialization)
values
    ('11111111-1111-1111-1111-111111111111', 'D001', 'Dr. Asha Rao', 'ABC Clinic — Main Branch', '', 30, true, 'General Medicine'),
    ('22222222-2222-2222-2222-222222222222', 'D002', 'Dr. Vikram Nair', 'ABC Clinic — Main Branch', '', 20, true, 'Pediatrics'),
    ('33333333-3333-3333-3333-333333333333', 'D003', 'Dr. Priya Menon', 'ABC Clinic — Main Branch', '', 30, false, 'Dermatology');

-- Weekday recurring availability — Mon-Fri mornings for every doctor,
-- plus evenings for the two active ones.
insert into doctor_availability (doctor_id, day_of_week, start_time, end_time)
select d.id, day, '09:00', '13:00'
from doctors d
cross join (values ('Monday'::weekday), ('Tuesday'::weekday), ('Wednesday'::weekday), ('Thursday'::weekday), ('Friday'::weekday)) as days(day);

insert into doctor_availability (doctor_id, day_of_week, start_time, end_time)
select d.id, day, '17:00', '20:00'
from doctors d
cross join (values ('Monday'::weekday), ('Wednesday'::weekday), ('Friday'::weekday)) as days(day)
where d.active;

-- One upcoming leave day for Dr. Rao.
insert into doctor_leaves (doctor_id, leave_date, reason)
values ('11111111-1111-1111-1111-111111111111', current_date + interval '10 days', 'Conference');

insert into patients (id, patient_code, phone, name, language, first_seen_at, last_visit_at)
values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PAT-20260101-0001', '919800000001', 'Kavya Reddy', 'EN', now() - interval '90 days', now() - interval '7 days'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PAT-20260102-0002', '919800000002', 'Rohan Gupta', 'TE', now() - interval '60 days', now() - interval '2 days'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PAT-20260103-0003', '919800000003', 'Sneha Iyer', 'HI', now() - interval '30 days', null);

-- A spread of appointment statuses so /admin/appointments has something
-- to filter against immediately.
insert into appointments (appointment_code, doctor_id, patient_id, patient_name, patient_phone, appointment_date, appointment_time, status)
values
    ('A00000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Kavya Reddy', '919800000001', current_date + interval '1 day', '09:30', 'Confirmed'),
    ('A00000002', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Rohan Gupta', '919800000002', current_date + interval '2 days', '10:00', 'Confirmed'),
    ('A00000003', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sneha Iyer', '919800000003', current_date - interval '7 days', '11:00', 'Completed'),
    ('A00000004', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Kavya Reddy', '919800000001', current_date - interval '3 days', '09:00', 'No-Show'),
    ('A00000005', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Rohan Gupta', '919800000002', current_date - interval '1 days', '12:00', 'Cancelled');

-- One pending home sample collection request.
insert into home_collection_requests (request_code, phone, patient_name, latitude, longitude, distance_km, preferred_date, time_window, status)
values ('HC0000001', '919800000003', 'Sneha Iyer', 17.4239, 78.4738, 3.2, current_date + interval '2 days', 'Morning (8 AM - 12 PM)', 'Requested');
