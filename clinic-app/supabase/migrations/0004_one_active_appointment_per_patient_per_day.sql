-- ============================================================
-- One active (Confirmed) appointment per patient per day, across all
-- doctors. Was the application-level hasActiveAppointmentOnDate() check
-- in src/Model_Appointments.gs (a full-sheet scan on every booking
-- attempt) — now a real constraint, so it can never be bypassed by a
-- bug in the app-level pre-check, only *duplicated* by one for a
-- friendlier error message before the constraint would fire.
--
-- Rescheduling changes an existing Confirmed row's date/time via UPDATE
-- rather than insert-new+cancel-old, so this same index also happens to
-- be exactly the right one to prevent "reschedule onto a day you
-- already have another appointment on" without needing any special-case
-- "exclude this appointment ID" logic the Apps Script version needed.
-- ============================================================

create unique index appointments_one_active_per_patient_per_day_idx
    on appointments (patient_phone, appointment_date)
    where status = 'Confirmed';
