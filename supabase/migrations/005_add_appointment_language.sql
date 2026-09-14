-- Add Patient Preferred Language to Appointments
-- Created: 2026-09-14
-- Purpose: Store patient's language preference for appointment reminders
-- Default: EN (English), also supports HI (Hindi)

ALTER TABLE appointments
ADD COLUMN preferred_language VARCHAR(5) DEFAULT 'EN';

CREATE INDEX idx_appointments_language ON appointments(clinic_id, preferred_language);
