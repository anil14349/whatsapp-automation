-- Clinic Branding Support
--
-- Enables white-label and customization per clinic
-- Color scheme, logos, custom domains, contact info

-- Add branding columns to clinic_settings
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS clinic_logo_url TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS clinic_logo_dark_url TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS theme_primary_color VARCHAR(7) DEFAULT '#0066cc';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS theme_secondary_color VARCHAR(7) DEFAULT '#00cc66';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS theme_accent_color VARCHAR(7) DEFAULT '#ff6600';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS clinic_website TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS clinic_support_email TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS clinic_phone TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS clinic_address TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS hide_branded_footer BOOLEAN DEFAULT false;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS favicon_url TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS branding_updated_at TIMESTAMPTZ DEFAULT now();

-- Create unique index for custom domain (only one clinic per domain)
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_domain_unique
ON clinic_settings(custom_domain) WHERE custom_domain IS NOT NULL;

-- Create index for branding updates (for cache invalidation)
CREATE INDEX IF NOT EXISTS idx_branding_updated_at
ON clinic_settings(clinic_id, branding_updated_at);

-- Branding presets table (save multiple color schemes)
CREATE TABLE IF NOT EXISTS branding_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  preset_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  primary_color VARCHAR(7) NOT NULL,
  secondary_color VARCHAR(7) NOT NULL,
  accent_color VARCHAR(7) NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, preset_name)
);

CREATE INDEX IF NOT EXISTS idx_branding_presets_clinic
ON branding_presets(clinic_id, is_default DESC);

-- Update clinic_settings updated_at on branding changes
DROP TRIGGER IF EXISTS update_clinic_settings_branding ON clinic_settings;

CREATE TRIGGER update_clinic_settings_branding
BEFORE UPDATE OF
  clinic_logo_url,
  clinic_logo_dark_url,
  theme_primary_color,
  theme_secondary_color,
  theme_accent_color,
  clinic_website,
  clinic_support_email,
  clinic_phone,
  clinic_address,
  hide_branded_footer,
  custom_domain,
  favicon_url
ON clinic_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Seed default branding for existing clinics (if any)
INSERT INTO branding_presets (
  clinic_id, preset_name, description, is_default,
  primary_color, secondary_color, accent_color
)
SELECT
  id, 'Default', 'Default branding colors', true,
  '#0066cc', '#00cc66', '#ff6600'
FROM clinics
WHERE id NOT IN (
  SELECT DISTINCT clinic_id FROM branding_presets
)
ON CONFLICT DO NOTHING;

-- RLS Policies for branding_presets
ALTER TABLE branding_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage clinic branding presets"
ON branding_presets
FOR ALL
USING (
  auth.uid() IN (
    SELECT au.id FROM admin_users au
    WHERE au.active = true
      AND au.role = 'ADMIN'
      AND au.clinic_id = branding_presets.clinic_id
  )
);

CREATE POLICY "Receptionists can view clinic branding presets"
ON branding_presets
FOR SELECT
USING (
  auth.uid() IN (
    SELECT au.id FROM admin_users au
    WHERE au.active = true
      AND au.clinic_id = branding_presets.clinic_id
  )
);

-- Comment on table
COMMENT ON TABLE branding_presets IS 'Save multiple branding color schemes per clinic for easy switching';
COMMENT ON COLUMN clinic_settings.theme_primary_color IS 'Primary brand color (hex format: #RRGGBB)';
COMMENT ON COLUMN clinic_settings.hide_branded_footer IS 'Hide "Powered by WhatsApp Clinic" footer in paid plans';
COMMENT ON COLUMN clinic_settings.custom_domain IS 'Custom domain for white-label deployment (e.g. clinic.example.com)';
