/**
 * Multi-Clinic Architecture TypeScript Types
 * Generated: 2026-09-14
 * 
 * All types are strictly typed for 100% type safety
 * Used by all handlers and business logic
 */

// ============================================================================
// CLINICS & CONFIGURATION
// ============================================================================

export interface Clinic {
  id: string;
  clinic_code: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  country: string;
  
  is_active: boolean;
  timezone: string;
  
  enable_home_collection: boolean;
  enable_diagnostic_center: boolean;
  enable_doctor_consultations: boolean;
  enable_doctor_home_visits: boolean;
  
  whatsapp_phone_number?: string;
  whatsapp_business_account_id?: string;
  
  subscription_tier: string;
  billing_email?: string;
  
  created_at: string;
  updated_at: string;
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

export interface ServiceType {
  id: string;
  name: string;
  description?: string;
  code: string;
  category?: string;
  
  default_duration_minutes: number;
  default_clinic_price?: number;
  default_home_price?: number;
  
  is_active: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface ClinicService {
  id: string;
  clinic_id: string;
  service_type_id: string;
  
  is_enabled: boolean;
  min_booking_window_hours: number;
  max_booking_window_days: number;
  
  clinic_price?: number;
  home_price?: number;
  
  display_order: number;
  
  created_at: string;
  updated_at: string;
  
  // Joined data
  service_type?: ServiceType;
}

// ============================================================================
// OPERATING HOURS & HOLIDAYS
// ============================================================================

export interface ClinicOperatingHours {
  id: string;
  clinic_id: string;
  
  day_of_week: number;  // 1-7
  opening_time: string;  // "09:00"
  closing_time: string;  // "18:00"
  
  is_active: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface ClinicHoliday {
  id: string;
  clinic_id: string;
  
  holiday_date: string;  // YYYY-MM-DD
  holiday_name: string;
  
  is_partial_closure: boolean;
  partial_opening_time?: string;
  partial_closing_time?: string;
  
  notes?: string;
  
  created_at: string;
  updated_at: string;
}

// ============================================================================
// DOCTORS
// ============================================================================

export interface Doctor {
  id: string;
  clinic_id: string;
  
  name: string;
  phone?: string;
  email?: string;
  
  specialization?: string;
  license_number?: string;
  years_experience?: number;
  
  is_active: boolean;
  can_do_home_visits: boolean;
  max_home_visits_per_day: number;
  
  // Availability status for real-time filtering
  availability_status: 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'IN_CONSULTATION' | 'OFFLINE';
  last_status_update?: string;
  
  emergency_contact_phone?: string;
  
  created_at: string;
  updated_at: string;
}

export interface DoctorService {
  id: string;
  clinic_id: string;
  doctor_id: string;
  service_type_id: string;
  
  is_enabled: boolean;
  can_do_clinic_visit: boolean;
  can_do_home_visit: boolean;
  
  clinic_price?: number;
  home_visit_price?: number;
  
  min_consultation_minutes: number;
  
  created_at: string;
  updated_at: string;
  
  // Joined data
  service_type?: ServiceType;
}

export interface DoctorOperatingHours {
  id: string;
  clinic_id: string;
  doctor_id: string;
  
  day_of_week: number;  // 1-7
  opening_time: string;
  closing_time: string;
  
  is_active: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface DoctorHomeVisitHours {
  id: string;
  clinic_id: string;
  doctor_id: string;
  
  day_of_week: number;
  opening_time: string;
  closing_time: string;
  
  min_travel_time_minutes: number;
  buffer_after_appointment_minutes: number;
  max_home_visits_per_day: number;
  
  is_active: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface DoctorLeave {
  id: string;
  clinic_id: string;
  doctor_id: string;
  
  leave_start_date: string;  // YYYY-MM-DD
  leave_end_date: string;
  
  leave_type?: string;  // VACATION, SICK, CONFERENCE
  reason?: string;
  
  status: string;  // PENDING, APPROVED, REJECTED, CANCELLED
  approved_by?: string;
  approval_date?: string;
  
  created_at: string;
  updated_at: string;
}

export interface DoctorServiceZone {
  id: string;
  clinic_id: string;
  doctor_id: string;
  
  zone_name: string;
  zone_code?: string;
  
  center_latitude?: number;
  center_longitude?: number;
  service_radius_km: number;
  
  postal_codes?: string;  // "110001,110002,110003"
  
  is_active: boolean;
  
  created_at: string;
  updated_at: string;
}

// ============================================================================
// APPOINTMENTS & SCHEDULING
// ============================================================================

export interface ServiceLocation {
  id: string;
  clinic_id: string;
  
  name: string;
  location_type: string;  // CLINIC, DIAGNOSTIC_CENTER, MOBILE_VAN, HOME
  
  address?: string;
  latitude?: number;
  longitude?: number;
  
  phone?: string;
  
  is_active: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface Patient {
  id: string;
  phone: string;  // Unique globally
  
  name: string;
  gender?: string;
  age?: number;
  email?: string;
  
  blood_group?: string;
  known_allergies?: string;
  
  total_appointments: number;
  last_appointment_date?: string;
  
  preferred_clinic_id?: string;
  preferred_doctor_id?: string;
  
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;  // APT_20260914_abc123
  clinic_id: string;
  
  doctor_id?: string;
  patient_phone: string;
  patient_name: string;
  
  service_type_id: string;
  service_location_id?: string;
  
  appointment_date: string;  // YYYY-MM-DD
  appointment_time: string;  // HH:MM
  duration_minutes: number;
  
  location_type: string;  // CLINIC, HOME, DIAGNOSTIC_CENTER, MOBILE_VAN
  
  service_address?: string;
  service_latitude?: number;
  service_longitude?: number;
  service_zone_id?: string;
  
  status: string;  // CONFIRMED, COMPLETED, NO_SHOW, CANCELLED, RESCHEDULED
  cancellation_reason?: string;
  rescheduled_from?: string;
  
  // Doctor home visit fields
  doctor_home_visit_schedule_id?: string;
  estimated_doctor_arrival?: string;
  actual_doctor_arrival?: string;
  actual_doctor_departure?: string;
  doctor_arrived_notification_sent: boolean;
  
  amount?: number;
  payment_status: string;  // PENDING, COMPLETED, FAILED

  /** Set when booked, so changing the clinic's window does not reclassify it. */
  is_revisit?: boolean;

  /** What the counter calls out. Sequential per doctor per day. */
  token_number?: number;

  notes?: string;
  
  created_at: string;
  updated_at: string;
  completed_at?: string;
  
  // Joined data
  service_type?: ServiceType;
  doctor?: Doctor;
  patient?: Patient;
  service_location?: ServiceLocation;
}

export interface DoctorHomeVisitSchedule {
  id: string;
  clinic_id: string;
  doctor_id: string;
  appointment_id: string;
  
  scheduled_visit_order?: number;
  estimated_arrival_time?: string;
  estimated_departure_time?: string;
  
  actual_arrival_time?: string;
  actual_departure_time?: string;
  doctor_arrived_notification_sent: boolean;
  
  visit_distance_km?: number;
  visit_travel_time_minutes?: number;
  
  visit_notes?: string;
  complications?: string;
  
  created_at: string;
  updated_at: string;
  
  // Joined data
  appointment?: Appointment;
  doctor?: Doctor;
}

// ============================================================================
// HOME COLLECTION
// ============================================================================

export interface HomeCollectionRequest {
  id: string;
  clinic_id: string;
  
  patient_phone: string;
  patient_name: string;
  
  service_address?: string;
  latitude?: number;
  longitude?: number;
  
  service_type_id?: string;
  
  status: string;  // PENDING, ASSIGNED, ON_THE_WAY, COMPLETED, CANCELLED
  
  assigned_technician_id?: string;
  assigned_technician_name?: string;
  
  requested_date?: string;
  requested_time_window?: string;  // "09:00-11:00"
  eta_minutes?: number;
  
  completed_at?: string;
  completed_notes?: string;
  
  created_at: string;
  updated_at: string;
  
  // Joined data
  service_type?: ServiceType;
  patient?: Patient;
}

// ============================================================================
// QUERY RESULTS & RESPONSE TYPES
// ============================================================================

export interface AvailableDoctorSlot {
  doctor_id: string;
  doctor_name: string;
  service_name: string;
  appointment_time: string;
  estimated_arrival_time?: string;
  price: number;
  zone_name?: string;
  existing_visits_today: number;
  max_visits: number;
  can_do_home_visit: boolean;
}

export interface DoctorDaySchedule {
  appointment_id: string;
  patient_name: string;
  appointment_time: string;
  service_name: string;
  location_type: string;
  service_address?: string;
  scheduled_visit_order?: number;
  estimated_arrival_time?: string;
  actual_arrival_time?: string;
  visit_notes?: string;
  status: string;
}

export interface AppointmentSummary {
  appointment_id: string;
  doctor_name: string;
  appointment_date: string;
  appointment_time: string;
  service_name: string;
  location_type: string;
  status: string;
  amount: number;
}

// ============================================================================
// SESSION & STATE MANAGEMENT
// ============================================================================

export interface WhatsAppSession {
  id?: string;
  phone_number: string;
  clinic_id: string;  // NEW: Multi-clinic support
  current_state: string;
  role: string;  // PATIENT, DOCTOR, HOME_COLLECTION_PERSON
  language: string;  // EN, HI
  state_data: Record<string, any>;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface BookingState {
  selected_doctor_id?: string;
  selected_doctor_name?: string;
  selected_service_id?: string;
  selected_service_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  location_type?: string;
  patient_name?: string;
  patient_address?: string;
  patient_latitude?: number;
  patient_longitude?: number;
  service_zone_id?: string;
  appointment_id?: string;
  price?: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateAppointmentRequest {
  clinic_id: string;
  doctor_id?: string;
  patient_phone: string;
  patient_name: string;
  service_type_id: string;
  appointment_date: string;
  appointment_time: string;
  location_type: string;
  preferred_language?: string;  // "EN" or "HI" for reminder messages
  service_address?: string;
  service_latitude?: number;
  service_longitude?: number;
  amount?: number;
  notes?: string;
}

export interface UpdateAppointmentStatusRequest {
  appointment_id: string;
  new_status: string;
  cancellation_reason?: string;
  completion_notes?: string;
}

export interface CreateHomeVisitScheduleRequest {
  clinic_id: string;
  doctor_id: string;
  appointment_id: string;
  scheduled_visit_order: number;
  estimated_arrival_time: string;
  estimated_departure_time: string;
}

export interface UpdateHomeVisitTrackingRequest {
  home_visit_schedule_id: string;
  actual_arrival_time?: string;
  actual_departure_time?: string;
  visit_notes?: string;
  visit_distance_km?: number;
  visit_travel_time_minutes?: number;
}

// ============================================================================
// APPOINTMENT REMINDERS
// ============================================================================

export interface AppointmentReminder {
  id: string;
  clinic_id: string;
  appointment_id: string;
  patient_phone: string;
  
  reminder_type: '24_HOUR' | '1_HOUR';
  scheduled_time: string;
  sent_at?: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  
  message_id?: string;
  error_message?: string;
  
  attempts: number;
  max_attempts: number;
  
  created_at: string;
  updated_at: string;
}

export interface SendReminderRequest {
  clinic_id: string;
  appointment_id: string;
  reminder_type: '24_HOUR' | '1_HOUR';
}

export interface ReminderMessageContent {
  reminderType: '24_HOUR' | '1_HOUR';
  patientName: string;
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
  language: string;  // "EN" or "HI"
}

// ============================================================================
// HOME COLLECTION REMINDERS
// ============================================================================

export interface HomeCollectionReminder {
  id: string;
  clinic_id: string;
  request_id: string;
  patient_phone: string;
  
  scheduled_time: string;
  sent_at?: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  
  message_id?: string;
  error_message?: string;
  preferred_language: string; // "EN" or "HI"
  
  attempts: number;
  max_attempts: number;
  
  created_at: string;
  updated_at: string;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, any>;
}

export class ClinicError extends Error {
  constructor(
    message: string,
    public code: string = 'CLINIC_ERROR',
    public statusCode: number = 400
  ) {
    super(message);
  }
}

export class MultiTenancyError extends ClinicError {
  constructor(message: string) {
    super(message, 'MULTI_TENANCY_ERROR', 403);
  }
}

export class InvalidBookingError extends ClinicError {
  constructor(message: string) {
    super(message, 'INVALID_BOOKING', 400);
  }
}

export class DoctorUnavailableError extends ClinicError {
  constructor(message: string) {
    super(message, 'DOCTOR_UNAVAILABLE', 409);
  }
}

export class OutOfServiceZoneError extends ClinicError {
  constructor(message: string) {
    super(message, 'OUT_OF_SERVICE_ZONE', 400);
  }
}
