-- Add Doctor Availability Status
-- Created: 2026-09-14
-- Purpose: Track real-time doctor availability for filtering appointment slots
-- Allows clinic staff to mark doctors as unavailable (on break, in consultation, offline, etc.)

-- ============================================================================
-- ALTER: doctors table - Add availability_status column
-- ============================================================================
ALTER TABLE doctors
ADD COLUMN availability_status VARCHAR(50) DEFAULT 'AVAILABLE',
ADD COLUMN last_status_update TIMESTAMP DEFAULT NOW();

-- Create index for filtering by availability
CREATE INDEX idx_doctors_availability ON doctors(clinic_id, availability_status);
CREATE INDEX idx_doctors_status_update ON doctors(clinic_id, last_status_update);

-- Add constraint to ensure valid status values
ALTER TABLE doctors
ADD CONSTRAINT valid_availability_status CHECK (
  availability_status IN ('AVAILABLE', 'BUSY', 'ON_BREAK', 'IN_CONSULTATION', 'OFFLINE')
);

-- ============================================================================
-- PURPOSE OF EACH STATUS:
-- ============================================================================
-- AVAILABLE: Doctor is actively accepting patients
-- BUSY: Doctor is with a patient, showing slots but may be full
-- ON_BREAK: Doctor is on a scheduled break, don't show any slots
-- IN_CONSULTATION: Doctor is in virtual/remote consultation, may be available for slots
-- OFFLINE: Doctor has gone offline, don't show any slots
