-- Migration: Create ENUM for patient request types
-- Date: 2026-09-11

-- Create ENUM type for patient_request_type
CREATE TYPE patient_request_type AS ENUM (
  'lab_collection',
  'prescription',
  'results',
  'bill',
  'feedback',
  'reschedule',
  'status',
  'doctor_info'
);

-- Add CHECK constraint to patient_requests for request_type column
-- This ensures only valid types can be inserted
ALTER TABLE patient_requests
ADD CONSTRAINT check_valid_request_type
CHECK (request_type IN ('lab_collection', 'prescription', 'results', 'bill', 'feedback', 'reschedule', 'status', 'doctor_info'));
