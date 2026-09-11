-- Migration: Add message status audit trail
-- Date: 2026-09-11

-- Create audit table to track all message status changes
CREATE TABLE IF NOT EXISTS message_status_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

  -- Status change tracking
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,

  -- Actor information (webhook or admin user)
  actor VARCHAR(50) DEFAULT 'webhook', -- 'webhook' or 'admin'
  actor_id UUID, -- User ID if admin, NULL if webhook

  -- Timestamps
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE message_status_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their clinic's message audit"
  ON message_status_audit FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));

CREATE POLICY "System can insert audit records"
  ON message_status_audit FOR INSERT
  WITH CHECK (
    clinic_id IS NOT NULL
    AND (auth.role() = 'service_role' OR
         clinic_id IN (
           SELECT DISTINCT clinic_id FROM admin_users
           WHERE user_id = auth.uid()
         )
    )
  );

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_message_status_audit_clinic_id
ON message_status_audit(clinic_id);

CREATE INDEX IF NOT EXISTS idx_message_status_audit_message_id
ON message_status_audit(message_id);

CREATE INDEX IF NOT EXISTS idx_message_status_audit_changed_at
ON message_status_audit(changed_at DESC);
