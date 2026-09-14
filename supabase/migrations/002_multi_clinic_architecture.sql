-- Multi-Clinic Architecture Migration
-- Created: 2026-09-14
-- Tables: 16 total
-- Migration: Replaces Google Sheets/Calendar with Supabase

-- ============================================================================
-- TABLE 1: clinics (Base Configuration)
-- ============================================================================
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_code TEXT UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'India',
  
  -- Configuration
  is_active BOOLEAN DEFAULT true,
  timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
  
  -- Service flags
  enable_home_collection BOOLEAN DEFAULT true,
  enable_diagnostic_center BOOLEAN DEFAULT true,
  enable_doctor_consultations BOOLEAN DEFAULT true,
  enable_doctor_home_visits BOOLEAN DEFAULT true,
  
  -- WhatsApp
  whatsapp_phone_number VARCHAR(20),
  whatsapp_business_account_id VARCHAR(100),
  
  -- Billing
  subscription_tier VARCHAR(50) DEFAULT 'PRO',
  billing_email VARCHAR(255),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT clinic_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX idx_clinics_active ON clinics(is_active);
CREATE INDEX idx_clinics_code ON clinics(clinic_code);

-- ============================================================================
-- TABLE 2: service_types (Global Service Catalog)
-- ============================================================================
CREATE TABLE service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  code VARCHAR(50) UNIQUE NOT NULL,
  
  -- Service category
  category VARCHAR(50),  -- CONSULTATION, VACCINE, BLOOD_TEST, IMAGING, DIAGNOSTIC
  
  -- Defaults
  default_duration_minutes INT DEFAULT 30,
  default_clinic_price DECIMAL(10, 2),
  default_home_price DECIMAL(10, 2),
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_service_types_code ON service_types(code);
CREATE INDEX idx_service_types_active ON service_types(is_active);

-- ============================================================================
-- TABLE 3: clinic_services (Which services each clinic offers)
-- ============================================================================
CREATE TABLE clinic_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  
  -- Configuration
  is_enabled BOOLEAN DEFAULT true,
  min_booking_window_hours INT DEFAULT 1,
  max_booking_window_days INT DEFAULT 30,
  
  -- Pricing override
  clinic_price DECIMAL(10, 2),
  home_price DECIMAL(10, 2),
  
  -- Display
  display_order INT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(clinic_id, service_type_id)
);

CREATE INDEX idx_clinic_services_clinic ON clinic_services(clinic_id);
CREATE INDEX idx_clinic_services_enabled ON clinic_services(clinic_id, is_enabled);

-- ============================================================================
-- TABLE 4: clinic_operating_hours (Base clinic hours per day)
-- ============================================================================
CREATE TABLE clinic_operating_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  
  day_of_week INT NOT NULL,  -- 1=Monday, 7=Sunday
  opening_time VARCHAR(5) NOT NULL,  -- "09:00"
  closing_time VARCHAR(5) NOT NULL,  -- "18:00"
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(clinic_id, day_of_week),
  CONSTRAINT valid_day_of_week CHECK (day_of_week >= 1 AND day_of_week <= 7),
  CONSTRAINT valid_time_format CHECK (opening_time ~ '^\d{2}:\d{2}$' AND closing_time ~ '^\d{2}:\d{2}$')
);

CREATE INDEX idx_clinic_hours_clinic ON clinic_operating_hours(clinic_id);

-- ============================================================================
-- TABLE 5: clinic_holidays (Clinic-specific closures)
-- ============================================================================
CREATE TABLE clinic_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  
  holiday_date DATE NOT NULL,
  holiday_name VARCHAR(255),
  
  -- Partial closure
  is_partial_closure BOOLEAN DEFAULT false,
  partial_opening_time VARCHAR(5),  -- For emergency-only
  partial_closing_time VARCHAR(5),
  
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(clinic_id, holiday_date)
);

CREATE INDEX idx_clinic_holidays_clinic_date ON clinic_holidays(clinic_id, holiday_date);

-- ============================================================================
-- TABLE 6: doctors (Clinic-specific doctors)
-- ============================================================================
CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  
  -- Professional
  specialization VARCHAR(255),
  license_number VARCHAR(100),
  years_experience INT,
  
  -- Configuration
  is_active BOOLEAN DEFAULT true,
  can_do_home_visits BOOLEAN DEFAULT false,  -- Doctor-level flag
  max_home_visits_per_day INT DEFAULT 8,
  
  -- Contact
  emergency_contact_phone VARCHAR(20),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(clinic_id, license_number)
);

CREATE INDEX idx_doctors_clinic ON doctors(clinic_id);
CREATE INDEX idx_doctors_active ON doctors(clinic_id, is_active);

-- ============================================================================
-- TABLE 7: doctor_services (What services each doctor provides)
-- ============================================================================
CREATE TABLE doctor_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  
  -- Service capabilities
  is_enabled BOOLEAN DEFAULT true,
  can_do_clinic_visit BOOLEAN DEFAULT true,
  can_do_home_visit BOOLEAN DEFAULT false,
  
  -- Pricing override
  clinic_price DECIMAL(10, 2),
  home_visit_price DECIMAL(10, 2),
  
  -- Consultation time
  min_consultation_minutes INT DEFAULT 30,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(doctor_id, service_type_id)
);

CREATE INDEX idx_doctor_services_doctor ON doctor_services(doctor_id);
CREATE INDEX idx_doctor_services_service ON doctor_services(service_type_id);
CREATE INDEX idx_doctor_services_clinic ON doctor_services(clinic_id);

-- ============================================================================
-- TABLE 8: doctor_operating_hours (Doctor-specific clinic hours)
-- ============================================================================
CREATE TABLE doctor_operating_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  
  day_of_week INT NOT NULL,  -- 1=Monday, 7=Sunday
  opening_time VARCHAR(5) NOT NULL,
  closing_time VARCHAR(5) NOT NULL,
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(doctor_id, day_of_week),
  CONSTRAINT valid_day_of_week CHECK (day_of_week >= 1 AND day_of_week <= 7)
);

CREATE INDEX idx_doctor_hours_doctor ON doctor_operating_hours(doctor_id);
CREATE INDEX idx_doctor_hours_clinic ON doctor_operating_hours(clinic_id);

-- ============================================================================
-- TABLE 9: doctor_home_visit_hours (Doctor's home visit availability)
-- ============================================================================
CREATE TABLE doctor_home_visit_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  
  day_of_week INT NOT NULL,  -- 1=Monday, 7=Sunday
  opening_time VARCHAR(5) NOT NULL,
  closing_time VARCHAR(5) NOT NULL,
  
  -- Travel logistics
  min_travel_time_minutes INT DEFAULT 15,
  buffer_after_appointment_minutes INT DEFAULT 10,
  max_home_visits_per_day INT DEFAULT 8,
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(doctor_id, day_of_week)
);

CREATE INDEX idx_doctor_home_hours_doctor ON doctor_home_visit_hours(doctor_id);
CREATE INDEX idx_doctor_home_hours_clinic ON doctor_home_visit_hours(clinic_id);

-- ============================================================================
-- TABLE 10: doctor_leaves (Doctor absences)
-- ============================================================================
CREATE TABLE doctor_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  
  leave_start_date DATE NOT NULL,
  leave_end_date DATE NOT NULL,
  
  leave_type VARCHAR(50),  -- VACATION, SICK, CONFERENCE, SABBATICAL
  reason TEXT,
  
  status VARCHAR(50) DEFAULT 'PENDING',  -- PENDING, APPROVED, REJECTED, CANCELLED
  approved_by UUID,  -- Admin who approved
  approval_date TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_date_range CHECK (leave_end_date >= leave_start_date)
);

CREATE INDEX idx_doctor_leaves_doctor_date ON doctor_leaves(doctor_id, leave_start_date);
CREATE INDEX idx_doctor_leaves_status ON doctor_leaves(doctor_id, status);

-- ============================================================================
-- TABLE 11: doctor_service_zones (Geographic areas each doctor serves)
-- ============================================================================
CREATE TABLE doctor_service_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  
  -- Zone identification
  zone_name VARCHAR(255) NOT NULL,  -- "North Delhi"
  zone_code VARCHAR(50),  -- "NORTH_DELHI"
  
  -- Geographic boundaries
  center_latitude DECIMAL(10, 8),
  center_longitude DECIMAL(11, 8),
  service_radius_km INT DEFAULT 5,
  
  -- Alternative: postal codes
  postal_codes TEXT,  -- "110001,110002,110003"
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(doctor_id, zone_code)
);

CREATE INDEX idx_doctor_zones_doctor ON doctor_service_zones(doctor_id);
CREATE INDEX idx_doctor_zones_zone_code ON doctor_service_zones(zone_code);

-- ============================================================================
-- TABLE 12: service_locations (Where services can be done)
-- ============================================================================
CREATE TABLE service_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,  -- "Main Clinic", "Partner Lab", "Mobile Van"
  location_type VARCHAR(50),  -- CLINIC, DIAGNOSTIC_CENTER, MOBILE_VAN, HOME
  
  address TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  phone VARCHAR(20),
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_service_locations_clinic ON service_locations(clinic_id);
CREATE INDEX idx_service_locations_type ON service_locations(location_type);

-- ============================================================================
-- TABLE 13: patients (Global patient records)
-- ============================================================================
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  
  name VARCHAR(255) NOT NULL,
  gender VARCHAR(20),
  age INT,
  email VARCHAR(255),
  
  -- Medical info
  blood_group VARCHAR(10),
  known_allergies TEXT,
  
  -- Stats
  total_appointments INT DEFAULT 0,
  last_appointment_date DATE,
  
  -- Preferences
  preferred_clinic_id UUID REFERENCES clinics(id),
  preferred_doctor_id UUID REFERENCES doctors(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_created_at ON patients(created_at);

-- ============================================================================
-- TABLE 14: appointments (Enhanced with doctor home visits)
-- ============================================================================
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,  -- APT_20260914_abc123
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  
  -- Participants
  doctor_id UUID REFERENCES doctors(id),
  patient_phone VARCHAR(20) NOT NULL,
  patient_name VARCHAR(255),
  
  -- Service
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  service_location_id UUID REFERENCES service_locations(id),
  
  -- Scheduling
  appointment_date DATE NOT NULL,
  appointment_time VARCHAR(5) NOT NULL,  -- "15:00"
  duration_minutes INT DEFAULT 30,
  
  location_type VARCHAR(50),  -- CLINIC, HOME, DIAGNOSTIC_CENTER, MOBILE_VAN
  
  -- Address for home visits
  service_address TEXT,
  service_latitude DECIMAL(10, 8),
  service_longitude DECIMAL(11, 8),
  service_zone_id UUID REFERENCES doctor_service_zones(id),
  
  -- Status
  status VARCHAR(20) DEFAULT 'CONFIRMED',  -- CONFIRMED, COMPLETED, NO_SHOW, CANCELLED, RESCHEDULED
  cancellation_reason TEXT,
  rescheduled_from TEXT,  -- Reference to previous appointment ID
  
  -- Doctor home visit fields
  doctor_home_visit_schedule_id UUID,
  estimated_doctor_arrival TIMESTAMP,
  actual_doctor_arrival TIMESTAMP,
  actual_doctor_departure TIMESTAMP,
  doctor_arrived_notification_sent BOOLEAN DEFAULT false,
  
  -- Payment
  amount DECIMAL(10, 2),
  payment_status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, COMPLETED, FAILED
  
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_appointments_clinic ON appointments(clinic_id);
CREATE INDEX idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX idx_appointments_patient ON appointments(patient_phone);
CREATE INDEX idx_appointments_date ON appointments(appointment_date);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_service ON appointments(service_type_id);
CREATE INDEX idx_appointments_location_type ON appointments(location_type);

-- ============================================================================
-- TABLE 15: doctor_home_visit_schedules (Track home visit routes)
-- ============================================================================
CREATE TABLE doctor_home_visit_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  
  -- Route planning
  scheduled_visit_order INT,  -- 1st, 2nd, 3rd visit today
  estimated_arrival_time TIMESTAMP,
  estimated_departure_time TIMESTAMP,
  
  -- Real-time tracking
  actual_arrival_time TIMESTAMP,
  actual_departure_time TIMESTAMP,
  doctor_arrived_notification_sent BOOLEAN DEFAULT false,
  
  -- Distance & time
  visit_distance_km DECIMAL(10, 2),
  visit_travel_time_minutes INT,
  
  -- Notes
  visit_notes TEXT,
  complications TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_home_visit_schedules_doctor ON doctor_home_visit_schedules(doctor_id, estimated_arrival_time);
CREATE INDEX idx_home_visit_schedules_appointment ON doctor_home_visit_schedules(appointment_id);
CREATE INDEX idx_home_visit_schedules_order ON doctor_home_visit_schedules(clinic_id, doctor_id, scheduled_visit_order);

-- ============================================================================
-- TABLE 16: home_collection_requests (Home blood collection)
-- ============================================================================
CREATE TABLE home_collection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  
  patient_phone VARCHAR(20) NOT NULL,
  patient_name VARCHAR(255),
  
  -- Location
  service_address TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Service
  service_type_id UUID REFERENCES service_types(id),
  
  -- Status
  status VARCHAR(50) DEFAULT 'PENDING',  -- PENDING, ASSIGNED, ON_THE_WAY, COMPLETED, CANCELLED
  
  -- Technician
  assigned_technician_id UUID,
  assigned_technician_name VARCHAR(255),
  
  -- Timing
  requested_date DATE,
  requested_time_window VARCHAR(50),  -- "09:00-11:00"
  eta_minutes INT,
  
  -- Completion
  completed_at TIMESTAMP,
  completed_notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_home_collection_clinic ON home_collection_requests(clinic_id);
CREATE INDEX idx_home_collection_patient ON home_collection_requests(patient_phone);
CREATE INDEX idx_home_collection_status ON home_collection_requests(status);
CREATE INDEX idx_home_collection_date ON home_collection_requests(requested_date);

-- ============================================================================
-- RLS POLICIES (Multi-Tenancy Enforcement)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_home_visit_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_service_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_home_visit_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_collection_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Service Types (no clinic restriction, global)
CREATE POLICY "service_types_read_all" ON service_types FOR SELECT USING (true);

-- RLS Policy: Clinic Data (clinic_id must match)
CREATE POLICY "clinic_services_read" ON clinic_services FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "clinic_operating_hours_read" ON clinic_operating_hours FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "clinic_holidays_read" ON clinic_holidays FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctors_read" ON doctors FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctor_services_read" ON doctor_services FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctor_operating_hours_read" ON doctor_operating_hours FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctor_home_visit_hours_read" ON doctor_home_visit_hours FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctor_leaves_read" ON doctor_leaves FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctor_service_zones_read" ON doctor_service_zones FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "service_locations_read" ON service_locations FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "appointments_read" ON appointments FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "doctor_home_visit_schedules_read" ON doctor_home_visit_schedules FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

CREATE POLICY "home_collection_requests_read" ON home_collection_requests FOR SELECT 
  USING (clinic_id IN (SELECT clinic_id FROM auth.users WHERE auth.uid() = auth.uid()));

-- ============================================================================
-- SEED DATA (Default Clinic Setup)
-- ============================================================================

-- Create default clinic
INSERT INTO clinics (
  clinic_code, name, phone, email, address, city,
  enable_home_collection, enable_diagnostic_center, 
  enable_doctor_consultations, enable_doctor_home_visits
) VALUES (
  'DEFAULT_CLINIC', 'ABC Clinic', '+91-11-1234-5678', 'info@abc-clinic.com',
  '123 Medical Street', 'Delhi', true, true, true, true
);

-- Get clinic ID for seed data
WITH clinic_data AS (
  SELECT id FROM clinics WHERE clinic_code = 'DEFAULT_CLINIC' LIMIT 1
)
INSERT INTO clinic_operating_hours (clinic_id, day_of_week, opening_time, closing_time)
SELECT clinic_data.id, day_of_week, opening_time, closing_time
FROM clinic_data, (
  VALUES 
    (1, '09:00', '18:00'),  -- Monday
    (2, '09:00', '18:00'),  -- Tuesday
    (3, '09:00', '18:00'),  -- Wednesday
    (4, '09:00', '18:00'),  -- Thursday
    (5, '09:00', '18:00'),  -- Friday
    (6, '10:00', '14:00'),  -- Saturday
    (7, '00:00', '00:00')   -- Sunday (closed)
) AS hours(day_of_week, opening_time, closing_time);

-- Seed service types
INSERT INTO service_types (name, code, category, default_duration_minutes, default_clinic_price, default_home_price)
VALUES
  ('Doctor Consultation', 'CONSULTATION', 'CONSULTATION', 30, 500.00, 750.00),
  ('Blood Test', 'BLOOD_TEST', 'DIAGNOSTIC', 15, 200.00, 300.00),
  ('Vaccine', 'VACCINE', 'VACCINE', 10, 300.00, 450.00),
  ('Medical Imaging', 'IMAGING', 'IMAGING', 45, 1500.00, NULL),
  ('Sample Collection', 'SAMPLE_COLLECTION', 'DIAGNOSTIC', 10, 100.00, 150.00);

COMMIT;

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================
-- Run this migration in Supabase SQL Editor
-- All 16 tables will be created with indexes and basic seed data
-- RLS policies are enabled but simplified for development
-- For production, refine RLS policies to use proper clinic_id from JWT claims
