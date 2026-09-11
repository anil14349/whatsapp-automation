-- Migration: Add composite indexes for query optimization
-- Date: 2026-09-11

-- Composite index for common messages queries
CREATE INDEX IF NOT EXISTS idx_messages_clinic_phone
ON messages(clinic_id, patient_phone);

-- Composite index for patient_requests filtering by type
CREATE INDEX IF NOT EXISTS idx_patient_requests_clinic_type
ON patient_requests(clinic_id, request_type);

-- Composite index for appointment queries by patient, date, and status
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date
ON appointments(patient_phone, appointment_date DESC, status);

-- Composite index for delivery stats queries by clinic and date
CREATE INDEX IF NOT EXISTS idx_message_delivery_stats_clinic_date
ON message_delivery_stats(clinic_id, date DESC);

-- Index for webhook event status lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_clinic_status
ON webhook_events(clinic_id, status);

-- Index for booking requests by clinic and status
CREATE INDEX IF NOT EXISTS idx_booking_requests_clinic_status
ON booking_requests(clinic_id, status);
