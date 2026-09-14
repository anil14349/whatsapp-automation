-- Add Appointment Reminders Tracking
-- Created: 2026-09-14
-- Purpose: Track reminder messages sent to prevent duplicates and enable idempotency
-- Reminders: 24-hour and 1-hour before appointment

-- ============================================================================
-- TABLE: appointment_reminders (Track sent reminders for idempotency)
-- ============================================================================
CREATE TABLE appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_phone VARCHAR(20) NOT NULL,
  
  -- Reminder type
  reminder_type VARCHAR(50) NOT NULL,  -- "24_HOUR" or "1_HOUR"
  
  -- Status tracking
  scheduled_time TIMESTAMP NOT NULL,  -- When reminder was supposed to be sent
  sent_at TIMESTAMP,  -- When reminder was actually sent (NULL = not sent yet)
  status VARCHAR(50) DEFAULT 'PENDING',  -- PENDING, SENT, FAILED, SKIPPED
  
  -- Message details
  message_id VARCHAR(255),  -- WhatsApp message ID (for tracking delivery)
  error_message TEXT,  -- Error details if FAILED
  
  -- Audit
  attempts INT DEFAULT 0,  -- Number of send attempts
  max_attempts INT DEFAULT 3,  -- Max retries before giving up
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(appointment_id, reminder_type),
  CONSTRAINT valid_reminder_type CHECK (reminder_type IN ('24_HOUR', '1_HOUR')),
  CONSTRAINT valid_status CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
);

CREATE INDEX idx_reminders_clinic_pending ON appointment_reminders(clinic_id, status) WHERE status = 'PENDING';
CREATE INDEX idx_reminders_scheduled_time ON appointment_reminders(scheduled_time) WHERE status = 'PENDING';
CREATE INDEX idx_reminders_appointment ON appointment_reminders(appointment_id);
CREATE INDEX idx_reminders_phone_status ON appointment_reminders(patient_phone, status);
