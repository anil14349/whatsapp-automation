-- ============================================================
-- WhatsApp Automation: Supabase Database Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SESSIONS TABLE
-- ============================================================
-- Replaces Google Sheets WhatsApp_Sessions sheet
-- Stores conversation state for each phone number

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Phone number (WhatsApp format: country code + number)
    phone TEXT NOT NULL UNIQUE,
    
    -- Role: "PATIENT", "DOCTOR", "HOME_COLLECTION_PERSON", etc.
    role TEXT NOT NULL DEFAULT 'PATIENT',
    
    -- Current conversation state
    -- Examples: "MAIN_MENU", "BOOK_DOCTOR", "BOOK_DATE", "BOOK_TIME", etc.
    state TEXT NOT NULL DEFAULT 'LANGUAGE_SELECT',
    
    -- Free-form JSON data for state-specific information
    -- Examples:
    --   {"doctorId": "D001", "selectedDate": "2026-09-15"}
    --   {"appointmentId": "A123", "action": "cancel"}
    data JSONB DEFAULT '{}'::jsonb,
    
    -- Metadata about the session
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Session expiry (automatically consider session stale after this)
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
    
    -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Ensure pre-existing installations receive the session expiry column.
ALTER TABLE whatsapp_sessions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE
        DEFAULT (NOW() + INTERVAL '24 hours');

CREATE INDEX idx_whatsapp_sessions_phone ON whatsapp_sessions(phone);
CREATE INDEX idx_whatsapp_sessions_role ON whatsapp_sessions(role);
CREATE INDEX idx_whatsapp_sessions_expires_at ON whatsapp_sessions(expires_at);
CREATE INDEX idx_whatsapp_sessions_updated_at ON whatsapp_sessions(updated_at DESC);

-- ============================================================
-- WHATSAPP LOG TABLE
-- ============================================================
-- Replaces Google Sheets WhatsApp_Log sheet
-- Logs all inbound/outbound messages and errors

CREATE TABLE IF NOT EXISTS whatsapp_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Direction: "INBOUND", "OUTBOUND", "WEBHOOK", "ERROR"
    direction TEXT NOT NULL,
    
    -- Sender/recipient phone number
    phone TEXT,
    
    -- Sender/recipient name (from WhatsApp profile)
    name TEXT,
    
    -- Message type: "text", "interactive", "template", "error", etc.
    status TEXT,
    
    -- Actual message content
    message TEXT,
    
    -- WhatsApp metadata
    message_id TEXT UNIQUE,
    phone_number_id TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_log_phone ON whatsapp_log(phone);
CREATE INDEX idx_whatsapp_log_direction ON whatsapp_log(direction);
CREATE INDEX idx_whatsapp_log_created_at ON whatsapp_log(created_at DESC);
CREATE INDEX idx_whatsapp_log_message_id ON whatsapp_log(message_id);

-- Auto-delete old logs (set retention policy via settings)
-- Logs older than 30 days will be cleaned up by edge function

-- ============================================================
-- MESSAGE DEDUP TABLE
-- ============================================================
-- Tracks processed message IDs to prevent duplicate processing
-- Replaces Apps Script cache-based idempotency

CREATE TABLE IF NOT EXISTS message_dedup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- WhatsApp message ID (unique per message)
    message_id TEXT NOT NULL UNIQUE,
    
    -- Sender phone (for correlation)
    phone TEXT,
    
    -- Processing status: "processing", "completed", "failed"
    status TEXT DEFAULT 'processing',
    
    -- Result data (if needed for debugging)
    result JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Expires after this (prevents table from growing indefinitely)
    -- Usually 24-48 hours after creation
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '48 hours')
);

CREATE INDEX idx_message_dedup_message_id ON message_dedup(message_id);
CREATE INDEX idx_message_dedup_phone ON message_dedup(phone);
CREATE INDEX idx_message_dedup_expires_at ON message_dedup(expires_at);
CREATE INDEX idx_message_dedup_status ON message_dedup(status);

-- ============================================================
-- SESSION CACHE TABLE
-- ============================================================
-- Fast cache for execution-scoped lookups
-- Replaces Apps Script global variables and caches

CREATE TABLE IF NOT EXISTS session_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Cache key (composite: scope:identifier)
    -- Examples:
    --   "doctor_record:D001"
    --   "doctor_whatsapp:919876543210"
    --   "patient_phone:919876543210"
    --   "appointment_id:A123"
    cache_key TEXT NOT NULL UNIQUE,
    
    -- Cached value (JSON serialized)
    value JSONB NOT NULL,
    
    -- Time-to-live
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX idx_session_cache_key ON session_cache(cache_key);
CREATE INDEX idx_session_cache_expires_at ON session_cache(expires_at);

-- Auto-cleanup: Remove expired cache entries daily

-- ============================================================
-- AUDIT LOG TABLE (Optional but Recommended)
-- ============================================================
-- Tracks all appointments changes for audit trail

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- What changed: "appointment_created", "appointment_cancelled", etc.
    action TEXT NOT NULL,
    
    -- Who/what triggered it: "patient:919876543210" or "doctor:D001"
    actor TEXT,
    
    -- What was affected: "appointment:A123"
    entity_type TEXT,
    entity_id TEXT,
    
    -- Before/after state
    before_state JSONB,
    after_state JSONB,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============================================================
-- ANALYTICS TABLE (Optional)
-- ============================================================
-- Track metrics for monitoring dashboard

CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Event type: "message_received", "appointment_booked", "reminder_sent", etc.
    event_type TEXT NOT NULL,
    
    -- User phone
    phone TEXT,
    
    -- Doctor ID (if applicable)
    doctor_id TEXT,
    
    -- Event metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX idx_analytics_events_phone ON analytics_events(phone);

-- ============================================================
-- SETTINGS TABLE
-- ============================================================
-- Application configuration (replaces Settings sheet)

CREATE TABLE IF NOT EXISTS app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Setting key
    key TEXT NOT NULL UNIQUE,
    
    -- Setting value (string, but can be parsed as JSON)
    value TEXT,
    
    -- Data type for validation
    data_type TEXT DEFAULT 'string',
    
    -- Description
    description TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_app_settings_key ON app_settings(key);

-- Insert default settings
INSERT INTO app_settings (key, value, data_type, description) VALUES
    ('LOG_RETENTION_DAYS', '30', 'integer', 'Days to keep WhatsApp logs'),
    ('LOG_MAX_ROWS', '5000', 'integer', 'Maximum rows in log table'),
    ('SESSION_TTL_HOURS', '24', 'integer', 'Session time-to-live in hours'),
    ('ENABLE_APPOINTMENT_REMINDERS', 'true', 'boolean', 'Send appointment reminders'),
    ('REMINDER_HOURS_BEFORE', '24', 'integer', 'Hours before appointment to send reminder'),
    ('ENABLE_AFTER_HOURS_REPLY', 'false', 'boolean', 'Send after-hours auto-reply'),
    ('CLINIC_OPEN_TIME', '09:00', 'string', 'Clinic opening time'),
    ('CLINIC_CLOSE_TIME', '18:00', 'string', 'Clinic closing time'),
    ('CLINIC_WORKING_DAYS', 'Mon,Tue,Wed,Thu,Fri,Sat', 'string', 'Comma-separated working days'),
    ('AUTO_COMPLETE_PAST_APPOINTMENTS', 'false', 'boolean', 'Auto-complete past appointments'),
    ('AUTO_COMPLETE_HOURS_AFTER', '4', 'integer', 'Hours after appointment to auto-complete'),
    ('FEEDBACK_SAMPLING_RATE', '0.30', 'number', 'Fraction of users to survey (0-1)'),
    ('COST_OPTIMIZATION_SKIP_24H_REMINDER', 'false', 'boolean', 'Skip 24-hour reminders to save API calls')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- CLEANUP TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_whatsapp_sessions_updated_at
    BEFORE UPDATE ON whatsapp_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY (Optional)
-- ============================================================

-- Enable RLS on tables
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Create policies (allow edge functions to access all data)
-- This assumes authenticated requests from edge functions
CREATE POLICY "Allow service role on sessions"
    ON whatsapp_sessions
    FOR ALL
    USING (TRUE);

CREATE POLICY "Allow service role on log"
    ON whatsapp_log
    FOR ALL
    USING (TRUE);

CREATE POLICY "Allow service role on dedup"
    ON message_dedup
    FOR ALL
    USING (TRUE);

CREATE POLICY "Allow service role on cache"
    ON session_cache
    FOR ALL
    USING (TRUE);

CREATE POLICY "Allow service role on audit"
    ON audit_log
    FOR ALL
    USING (TRUE);
