-- Trigger Configuration Tables
-- Stores WhatsApp menu options, message templates, and settings

-- Menus: What options to show to patients/doctors
CREATE TABLE trigger_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL, -- "MAIN_MENU", "BOOK_DOCTOR", "LANGUAGE_SELECT", etc
  language TEXT NOT NULL DEFAULT 'EN', -- EN, TE, HI, KA, TA, ML
  title TEXT NOT NULL, -- "Welcome to ABC Clinic"
  description TEXT, -- "What would you like to do?"
  options JSONB NOT NULL, -- [{id, label, description}, ...]
  footer TEXT, -- "Reply with number"
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID, -- User who last updated
  UNIQUE(clinic_id, trigger_key, language),
  CONSTRAINT valid_language CHECK (language IN ('EN', 'TE', 'HI', 'KA', 'TA', 'ML'))
);

-- Message Templates: What messages to send
CREATE TABLE trigger_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL, -- "APPOINTMENT_REMINDER", "BOOKING_CONFIRMED", etc
  language TEXT NOT NULL DEFAULT 'EN',
  subject TEXT, -- For SMS/email (optional)
  body TEXT NOT NULL, -- Can include {{placeholder}} variables
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID,
  UNIQUE(clinic_id, template_key, language),
  CONSTRAINT valid_language CHECK (language IN ('EN', 'TE', 'HI', 'KA', 'TA', 'ML'))
);

-- Cron Job Configuration: When to run jobs
CREATE TABLE trigger_cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  job_name TEXT NOT NULL, -- "appointment_reminders", "auto_complete", etc
  description TEXT,
  schedule_expression TEXT NOT NULL, -- Cron format: "*/30 * * * *"
  endpoint TEXT NOT NULL, -- "/api/cron/reminders"
  enabled BOOLEAN DEFAULT true,
  timeout_seconds INTEGER DEFAULT 300,
  retry_count INTEGER DEFAULT 3,
  retry_delay_seconds INTEGER DEFAULT 60,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID,
  UNIQUE(clinic_id, job_name)
);

-- Settings & Feature Flags: Configuration per clinic
CREATE TABLE trigger_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL, -- "home_collection_radius", "max_booking_days", etc
  setting_value TEXT, -- Can be JSON for complex values
  value_type TEXT NOT NULL DEFAULT 'string', -- "string", "number", "boolean", "json"
  description TEXT,
  is_secret BOOLEAN DEFAULT false, -- Hide value in UI if true
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID,
  UNIQUE(clinic_id, setting_key)
);

-- Audit log for trigger changes
CREATE TABLE trigger_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL, -- "trigger_menus", "trigger_templates", etc
  record_id UUID NOT NULL,
  action TEXT NOT NULL, -- "INSERT", "UPDATE", "DELETE"
  old_values JSONB, -- Previous values for UPDATE
  new_values JSONB, -- New values for INSERT/UPDATE
  changed_by UUID, -- User who made change
  changed_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_trigger_menus_clinic_trigger ON trigger_menus(clinic_id, trigger_key, language);
CREATE INDEX idx_trigger_menus_enabled ON trigger_menus(clinic_id, enabled);
CREATE INDEX idx_trigger_templates_clinic_key ON trigger_templates(clinic_id, template_key, language);
CREATE INDEX idx_trigger_cron_jobs_clinic ON trigger_cron_jobs(clinic_id, enabled);
CREATE INDEX idx_trigger_settings_clinic_key ON trigger_settings(clinic_id, setting_key);
CREATE INDEX idx_trigger_audit_log_clinic ON trigger_audit_log(clinic_id, changed_at DESC);

-- Default menus for new clinics
INSERT INTO trigger_menus (clinic_id, trigger_key, language, title, description, options, footer, created_at)
SELECT
  clinics.id,
  'MAIN_MENU',
  'EN',
  'Welcome to {{clinic_name}}',
  'What would you like to do?',
  '[
    {"id":"1","label":"📅 Book Appointment","description":"Schedule a new appointment"},
    {"id":"2","label":"📋 My Appointments","description":"View and manage your appointments"},
    {"id":"3","label":"🌐 Change Language","description":"Select your preferred language"},
    {"id":"*","label":"📌 More Options","description":"Additional features"}
  ]'::jsonb,
  'Reply with a number',
  NOW()
FROM clinics
WHERE id NOT IN (SELECT clinic_id FROM trigger_menus WHERE trigger_key = 'MAIN_MENU' AND language = 'EN')
LIMIT 1;

-- Default message templates
INSERT INTO trigger_templates (clinic_id, template_key, language, body, created_at)
SELECT
  clinics.id,
  'APPOINTMENT_REMINDER',
  'EN',
  '👋 Hi {{patient_name}}!

Your appointment with {{doctor_name}} is tomorrow at {{appointment_time}}.

Code: {{appointment_code}}

Reply with:
1. Confirm
2. Reschedule
3. Cancel',
  NOW()
FROM clinics
WHERE id NOT IN (SELECT clinic_id FROM trigger_templates WHERE template_key = 'APPOINTMENT_REMINDER' AND language = 'EN')
LIMIT 1;

-- Permissions for RLS (Row Level Security)
ALTER TABLE trigger_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_cron_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their clinic's triggers
CREATE POLICY "Users can view their clinic's trigger menus"
ON trigger_menus FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their clinic's trigger menus"
ON trigger_menus FOR UPDATE
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
      AND role IN ('ADMIN')
  )
);

-- Similar policies for other tables
CREATE POLICY "Users can view their clinic's trigger templates"
ON trigger_templates FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their clinic's trigger templates"
ON trigger_templates FOR UPDATE
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
      AND role IN ('ADMIN')
  )
);

CREATE POLICY "Users can view their clinic's trigger settings"
ON trigger_settings FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their clinic's trigger settings"
ON trigger_settings FOR UPDATE
USING (
  clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE user_id = auth.uid()
      AND role IN ('ADMIN')
  )
);
