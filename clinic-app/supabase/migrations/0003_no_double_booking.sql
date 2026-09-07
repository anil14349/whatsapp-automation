-- ============================================================
-- Guarantee no double-booking at the DATABASE level.
--
-- The Apps Script version relied entirely on LockService (a mutex) plus
-- an application-level "scan existing appointments/Calendar events for
-- conflicts" check before writing. That's a best-effort guard, not a
-- guarantee — a bug in the lock/scan logic could still double-book a
-- slot. A partial unique index makes it structurally impossible: two
-- CONFIRMED appointments for the same doctor/date/time can never both
-- exist, no matter what application code does or forgets to check.
-- Cancelled appointments are excluded so a cancelled+rebooked slot is
-- fine.
-- ============================================================

create unique index appointments_no_double_booking_idx
    on appointments (doctor_id, appointment_date, appointment_time)
    where status <> 'Cancelled';
