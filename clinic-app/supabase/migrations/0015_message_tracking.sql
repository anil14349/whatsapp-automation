-- Migration: Add message tracking for webhook status updates
-- Date: 2026-09-10

-- Messages table to track all WhatsApp messages sent/received
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_phone VARCHAR(20) NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,

  -- Message identification
  whatsapp_message_id VARCHAR(100), -- ID from WhatsApp API
  message_type VARCHAR(50), -- 'incoming', 'outgoing'
  direction VARCHAR(20), -- 'to_patient', 'from_patient'

  -- Content
  content TEXT,
  message_payload JSONB, -- Full WhatsApp message object

  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending', -- 'sent', 'delivered', 'read', 'failed'
  error_message TEXT,

  -- Timestamps
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  failed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Message templates table
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Template info
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- 'greeting', 'confirmation', 'reminder', 'follow_up', etc.

  -- Content
  template_text TEXT NOT NULL,
  variables VARCHAR(100)[], -- Placeholders like [PATIENT_NAME], [DATE], etc.

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Message delivery logs for analytics
CREATE TABLE IF NOT EXISTS message_delivery_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  date DATE NOT NULL,
  total_sent INT DEFAULT 0,
  total_delivered INT DEFAULT 0,
  total_read INT DEFAULT 0,
  total_failed INT DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(clinic_id, date)
);

-- Booking requests table (extended from earlier)
CREATE TABLE IF NOT EXISTS booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_phone VARCHAR(20) NOT NULL,

  requested_date VARCHAR(50),
  requested_time VARCHAR(50),
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,

  message_text TEXT,
  booking_confidence FLOAT, -- 0-1, how confident we are this is a booking

  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'confirmed_by_patient', 'booked', 'rejected'
  webhook_event_id UUID REFERENCES webhook_events(id) ON DELETE SET NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Appointment cancellation requests
CREATE TABLE IF NOT EXISTS appointment_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,

  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending_approval', -- 'pending_approval', 'approved', 'rejected'
  approved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Patient requests (lab, prescription, results, etc.)
CREATE TABLE IF NOT EXISTS patient_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_phone VARCHAR(20) NOT NULL,

  request_type VARCHAR(50), -- 'lab_collection', 'prescription', 'results', 'bill', 'feedback', etc.
  request_text TEXT,
  request_payload JSONB,

  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'acknowledged', 'in_progress', 'resolved'
  assigned_to UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  notes TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_messages_clinic_id ON messages(clinic_id);
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_message_id ON messages(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_patient_phone ON messages(patient_phone);
-- Add UNIQUE constraint to prevent duplicate webhooks from creating duplicate records
ALTER TABLE messages
ADD CONSTRAINT messages_clinic_whatsapp_id_unique
UNIQUE(clinic_id, whatsapp_message_id);

-- Add CHECK constraint on message direction
ALTER TABLE messages
ADD CONSTRAINT check_message_direction
CHECK (direction IN ('to_patient', 'from_patient'));

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_requests_clinic_id ON booking_requests(clinic_id);
CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);
CREATE INDEX IF NOT EXISTS idx_booking_requests_patient_phone ON booking_requests(patient_phone);

CREATE INDEX IF NOT EXISTS idx_patient_requests_clinic_id ON patient_requests(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patient_requests_type ON patient_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_patient_requests_status ON patient_requests(status);

CREATE INDEX IF NOT EXISTS idx_message_delivery_stats_clinic_id ON message_delivery_stats(clinic_id);
CREATE INDEX IF NOT EXISTS idx_message_delivery_stats_date ON message_delivery_stats(date DESC);

-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_delivery_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies for messages
CREATE POLICY "Users can view their clinic's messages"
  ON messages FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "Webhook system can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    clinic_id IS NOT NULL
    AND (auth.role() = 'service_role' OR
         clinic_id IN (
           SELECT DISTINCT clinic_id FROM admin_users
           WHERE user_id = auth.uid()
         )
    )
  );

-- RLS Policies for booking_requests
CREATE POLICY "Users can view their clinic's booking requests"
  ON booking_requests FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "Webhook system can insert booking requests"
  ON booking_requests FOR INSERT
  WITH CHECK (
    clinic_id IS NOT NULL
    AND (auth.role() = 'service_role' OR
         clinic_id IN (
           SELECT DISTINCT clinic_id FROM admin_users
           WHERE user_id = auth.uid()
         )
    )
  );

-- RLS Policies for patient_requests
CREATE POLICY "Users can view their clinic's patient requests"
  ON patient_requests FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "Webhook system can insert patient requests"
  ON patient_requests FOR INSERT
  WITH CHECK (
    clinic_id IS NOT NULL
    AND (auth.role() = 'service_role' OR
         clinic_id IN (
           SELECT DISTINCT clinic_id FROM admin_users
           WHERE user_id = auth.uid()
         )
    )
  );

CREATE POLICY "Admins can update patient requests"
  ON patient_requests FOR UPDATE
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid() AND role = 'ADMIN'
  ));
