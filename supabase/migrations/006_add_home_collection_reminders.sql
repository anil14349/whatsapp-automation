-- Add home collection reminders table
-- Tracks reminders sent to patients for their scheduled home collection visits
-- Single reminder per request (unlike appointment reminders which have 24h and 1h)

CREATE TABLE IF NOT EXISTS home_collection_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  request_id VARCHAR(100) NOT NULL,
  patient_phone VARCHAR(20) NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, SENT, FAILED, SKIPPED
  message_id VARCHAR(255), -- WhatsApp message ID
  error_message TEXT,
  preferred_language VARCHAR(5) DEFAULT 'EN',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(request_id) -- Prevent duplicate reminders per request
);

-- Indexes for efficient querying
CREATE INDEX idx_home_collection_reminders_clinic_id 
  ON home_collection_reminders(clinic_id);

CREATE INDEX idx_home_collection_reminders_request_id 
  ON home_collection_reminders(request_id);

CREATE INDEX idx_home_collection_reminders_status 
  ON home_collection_reminders(status);

CREATE INDEX idx_home_collection_reminders_scheduled_time 
  ON home_collection_reminders(scheduled_time);

-- Composite index for common query: get pending reminders for clinic
CREATE INDEX idx_home_collection_reminders_clinic_status_time 
  ON home_collection_reminders(clinic_id, status, scheduled_time);

-- Update existing home_collection_requests to add preferred_language if not exists
ALTER TABLE home_collection_requests 
ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'EN';

-- Create index for preferred_language queries
CREATE INDEX IF NOT EXISTS idx_home_collection_requests_clinic_language 
  ON home_collection_requests(clinic_id, preferred_language);
