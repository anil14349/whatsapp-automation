-- Migration: Add webhook events and subscriptions tables
-- Date: 2026-09-10

-- Webhook events log table
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL, -- 'whatsapp', 'razorpay', 'calendar'
  event_type VARCHAR(100) NOT NULL, -- 'message', 'payment', 'appointment'
  payload JSONB NOT NULL, -- Full webhook payload
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processed', 'failed', 'retrying'
  retry_count INT DEFAULT 0,
  error_message TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Webhook subscriptions table
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  webhook_url VARCHAR(500),
  events VARCHAR[] DEFAULT '{}', -- array of event types this webhook subscribes to
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMP,
  failure_count INT DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Webhook settings table
CREATE TABLE IF NOT EXISTS webhook_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE CASCADE,
  whatsapp_verify_token VARCHAR(500) NOT NULL,
  whatsapp_business_account_id VARCHAR(100),
  whatsapp_webhook_enabled BOOLEAN DEFAULT FALSE,
  auto_process_bookings BOOLEAN DEFAULT TRUE,
  auto_send_confirmations BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_webhook_events_clinic_id ON webhook_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_clinic_id ON webhook_subscriptions(clinic_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_active ON webhook_subscriptions(is_active);

-- Enable RLS (Row Level Security)
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook_events
CREATE POLICY "Users can view their clinic's webhook events"
  ON webhook_events FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert webhook events for their clinic"
  ON webhook_events FOR INSERT
  WITH CHECK (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

-- RLS Policies for webhook_subscriptions
CREATE POLICY "Users can view their clinic's webhook subscriptions"
  ON webhook_subscriptions FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their clinic's webhook subscriptions"
  ON webhook_subscriptions FOR ALL
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid() AND role = 'ADMIN'
  ));

-- RLS Policies for webhook_settings
CREATE POLICY "Users can view their clinic's webhook settings"
  ON webhook_settings FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update their clinic's webhook settings"
  ON webhook_settings FOR UPDATE
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid() AND role = 'ADMIN'
  ));

-- Add webhook columns to existing appointments table if needed
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS webhook_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS webhook_event_id UUID REFERENCES webhook_events(id) ON DELETE SET NULL;
