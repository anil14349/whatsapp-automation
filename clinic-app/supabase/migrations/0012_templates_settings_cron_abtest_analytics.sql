-- A/B Testing Tables
CREATE TABLE ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL,                    -- "reminder_template_v2"
  template_key TEXT NOT NULL,                -- "APPOINTMENT_REMINDER"
  enabled BOOLEAN DEFAULT true,
  variants JSONB NOT NULL,                   -- {"control": 50, "variant_a": 50}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(clinic_id, test_key)
);

CREATE TABLE ab_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL,
  variant TEXT NOT NULL,                     -- "control", "variant_a", etc.
  user_id TEXT,                              -- Optional: patient/doctor ID
  event_type TEXT NOT NULL,                  -- "shown", "clicked", "error"
  created_at TIMESTAMP DEFAULT NOW()
);

-- Analytics Tables
CREATE TABLE menu_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  menu_key TEXT NOT NULL,                    -- "MAIN_MENU", "DOCTOR_MAIN_MENU"
  language TEXT NOT NULL,
  action TEXT NOT NULL,                      -- "shown", "clicked", "error"
  user_phone TEXT,                           -- Phone number for tracking
  selected_option TEXT,                      -- Which option was clicked
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE template_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,                -- "APPOINTMENT_REMINDER"
  language TEXT NOT NULL,
  action TEXT NOT NULL,                      -- "sent", "failed", "bounced"
  user_phone TEXT,
  error_message TEXT,                        -- If failed/bounced
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_ab_tests_clinic ON ab_tests(clinic_id);
CREATE INDEX idx_ab_test_results_clinic_test ON ab_test_results(clinic_id, test_key);
CREATE INDEX idx_ab_test_results_timestamp ON ab_test_results(created_at DESC);
CREATE INDEX idx_menu_analytics_clinic_menu ON menu_analytics(clinic_id, menu_key);
CREATE INDEX idx_menu_analytics_timestamp ON menu_analytics(timestamp DESC);
CREATE INDEX idx_template_analytics_clinic_template ON template_analytics(clinic_id, template_key);
CREATE INDEX idx_template_analytics_timestamp ON template_analytics(timestamp DESC);

-- RLS Policies
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their clinic's A/B tests"
ON ab_tests FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can view their clinic's A/B test results"
ON ab_test_results FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can view their clinic's menu analytics"
ON menu_analytics FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can view their clinic's template analytics"
ON template_analytics FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

-- Allow WhatsApp webhook to insert analytics (if service role)
CREATE POLICY "Service can insert menu analytics"
ON menu_analytics FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service can insert template analytics"
ON template_analytics FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service can insert A/B test results"
ON ab_test_results FOR INSERT
WITH CHECK (true);
