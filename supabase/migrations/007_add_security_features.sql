/**
 * Database Migration: Add security features
 * - Rate limiting for login attempts
 * - Password reset token management
 * 
 * Tables created:
 * 1. login_rate_limits - Track failed login attempts per user
 * 2. password_reset_tokens - Store password reset tokens
 */

-- Create login_rate_limits table
-- Tracks failed login attempts to prevent brute force attacks
CREATE TABLE IF NOT EXISTS login_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID NOT NULL,
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('doctor', 'receptionist')),
  clinic_id UUID NOT NULL,
  
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint: one record per user per clinic
  UNIQUE(user_id, user_type, clinic_id),
  
  -- Foreign key to clinics table
  CONSTRAINT fk_clinic FOREIGN KEY (clinic_id) 
    REFERENCES clinics(id) ON DELETE CASCADE
);

-- Create index for faster lookups
CREATE INDEX idx_login_rate_limits_user 
  ON login_rate_limits(user_id, user_type);
CREATE INDEX idx_login_rate_limits_clinic 
  ON login_rate_limits(clinic_id);
CREATE INDEX idx_login_rate_limits_locked 
  ON login_rate_limits(locked_until) 
  WHERE locked_until IS NOT NULL;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_login_rate_limits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER login_rate_limits_updated_at_trigger
  BEFORE UPDATE ON login_rate_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_login_rate_limits_updated_at();

-- Create password_reset_tokens table
-- Stores one-time reset tokens with expiration
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID NOT NULL,
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('doctor', 'receptionist')),
  
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Index on token for fast lookups
  CONSTRAINT fk_password_reset_expires 
    CHECK (expires_at > NOW())
);

-- Create indexes for faster lookups and cleanup
CREATE INDEX idx_password_reset_token 
  ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_user 
  ON password_reset_tokens(user_id, user_type);
CREATE INDEX idx_password_reset_expires 
  ON password_reset_tokens(expires_at);
CREATE INDEX idx_password_reset_unused 
  ON password_reset_tokens(used, expires_at) 
  WHERE used = FALSE;

-- Create function to clean up expired reset tokens (daily)
CREATE OR REPLACE FUNCTION cleanup_expired_password_reset_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM password_reset_tokens 
  WHERE expires_at < NOW() OR (used = TRUE AND used_at < NOW() - INTERVAL '1 day');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Cleanup function for rate limits (reset old records)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limit_records()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM login_rate_limits 
  WHERE last_failed_at < NOW() - INTERVAL '30 days' 
    AND failed_attempts = 0 
    AND locked_until IS NULL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments
COMMENT ON TABLE login_rate_limits IS 'Tracks failed login attempts per user to prevent brute force attacks';
COMMENT ON COLUMN login_rate_limits.failed_attempts IS 'Number of failed attempts in the current window';
COMMENT ON COLUMN login_rate_limits.locked_until IS 'Timestamp when the account lockout expires (NULL if not locked)';

COMMENT ON TABLE password_reset_tokens IS 'Stores one-time password reset tokens with expiration time';
COMMENT ON COLUMN password_reset_tokens.token IS 'Unique 32-character reset token';
COMMENT ON COLUMN password_reset_tokens.used IS 'Whether this token has been used for a reset';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'Timestamp when token was used';

-- Note: Row-level security (RLS) policies should be added separately
-- These tables should only be accessible to the backend service role
