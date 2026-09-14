-- ============================================================
-- Prevent double-booking a doctor's slot
-- ============================================================
-- getAvailableSlots filters out taken times, but nothing stopped two
-- concurrent requests passing that check and both inserting. Cancelled
-- appointments are excluded so a freed slot can be rebooked.

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot_unique
    ON appointments (doctor_id, appointment_date, appointment_time)
    WHERE status <> 'CANCELLED';
