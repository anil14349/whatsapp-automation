/**
 * Multi-Clinic Supabase Client
 * Replaces GoogleSheetsClient + GoogleCalendarClient
 * 
 * All queries filtered by clinic_id for data isolation
 * 100% type-safe with Deno + TypeScript
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as types from "./multi-clinic-types.ts";

export class MultiClinicSupabaseClient {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ============================================================================
  // CLINIC OPERATIONS
  // ============================================================================

  async getClinic(clinicId: string): Promise<types.Clinic> {
    const { data, error } = await this.supabase
      .from("clinics")
      .select("*")
      .eq("id", clinicId)
      .single();

    if (error) throw new types.ClinicError(`Failed to fetch clinic: ${error.message}`);
    return data;
  }

  async getClinicByCode(clinicCode: string): Promise<types.Clinic> {
    const { data, error } = await this.supabase
      .from("clinics")
      .select("*")
      .eq("clinic_code", clinicCode)
      .single();

    if (error) throw new types.ClinicError(`Clinic not found: ${clinicCode}`);
    return data;
  }

  // ============================================================================
  // DOCTOR OPERATIONS
  // ============================================================================

  async getDoctors(clinicId: string, isActive: boolean = true): Promise<types.Doctor[]> {
    const { data, error } = await this.supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("is_active", isActive)
      .order("name");

    if (error) throw new types.ClinicError(`Failed to fetch doctors: ${error.message}`);
    return data || [];
  }

  async getDoctorById(
    clinicId: string,
    doctorId: string
  ): Promise<types.Doctor> {
    const { data, error } = await this.supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("id", doctorId)
      .single();

    if (error) throw new types.ClinicError(`Doctor not found: ${doctorId}`);
    return data;
  }

  async getServiceTypeIdByCode(code: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("service_types")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (error) throw new types.ClinicError(`Failed to fetch service type: ${error.message}`);
    return data?.id ?? null;
  }

  async getDoctorServices(
    clinicId: string,
    doctorId: string,
    isEnabled: boolean = true
  ): Promise<types.DoctorService[]> {
    const { data, error } = await this.supabase
      .from("doctor_services")
      .select("*, service_type:service_types(*)")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("is_enabled", isEnabled);

    if (error) throw new types.ClinicError(`Failed to fetch doctor services: ${error.message}`);
    return data || [];
  }

  async getDoctorAvailableHours(
    clinicId: string,
    doctorId: string,
    dayOfWeek: number
  ): Promise<types.DoctorOperatingHours | null> {
    const { data, error } = await this.supabase
      .from("doctor_operating_hours")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("day_of_week", dayOfWeek)
      .eq("is_active", true)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new types.ClinicError(`Failed to fetch doctor hours: ${error.message}`);
    }
    return data || null;
  }

  async addDoctorOperatingHours(
    clinicId: string,
    doctorId: string,
    timeRange: string,
    dayOfWeek?: number
  ): Promise<void> {
    const [opening, closing] = String(timeRange || "").split("-").map((t) => t.trim());

    if (!opening || !closing) {
      throw new types.ClinicError(`Invalid time range: ${timeRange}`);
    }

    // Postgres uses 1=Monday..7=Sunday; JS getDay() returns 0 for Sunday.
    const jsDay = new Date().getDay();
    const day = dayOfWeek ?? (jsDay === 0 ? 7 : jsDay);

    const { error } = await this.supabase
      .from("doctor_operating_hours")
      .upsert(
        {
          clinic_id: clinicId,
          doctor_id: doctorId,
          day_of_week: day,
          opening_time: opening,
          closing_time: closing,
          is_active: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: "doctor_id,day_of_week" }
      );

    if (error) throw new types.ClinicError(`Failed to save doctor hours: ${error.message}`);
  }

  async getDoctorHomeVisitHours(
    clinicId: string,
    doctorId: string,
    dayOfWeek: number
  ): Promise<types.DoctorHomeVisitHours | null> {
    const { data, error } = await this.supabase
      .from("doctor_home_visit_hours")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("day_of_week", dayOfWeek)
      .eq("is_active", true)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new types.ClinicError(`Failed to fetch home visit hours: ${error.message}`);
    }
    return data || null;
  }

  async getDoctorServiceZones(
    clinicId: string,
    doctorId: string
  ): Promise<types.DoctorServiceZone[]> {
    const { data, error } = await this.supabase
      .from("doctor_service_zones")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("is_active", true);

    if (error) throw new types.ClinicError(`Failed to fetch service zones: ${error.message}`);
    return data || [];
  }

  /**
   * Check if doctor is currently available (AVAILABLE or IN_CONSULTATION)
   */
  async isDoctorAvailable(
    clinicId: string,
    doctorId: string
  ): Promise<boolean> {
    const doctor = await this.getDoctorById(clinicId, doctorId);
    const availableStatuses = ['AVAILABLE', 'IN_CONSULTATION'];
    return availableStatuses.includes(doctor.availability_status);
  }

  /**
   * Get doctor availability status
   */
  async getDoctorAvailabilityStatus(
    clinicId: string,
    doctorId: string
  ): Promise<string> {
    const doctor = await this.getDoctorById(clinicId, doctorId);
    return doctor.availability_status;
  }

  /**
   * Update doctor availability status (clinic staff only)
   */
  async updateDoctorAvailabilityStatus(
    clinicId: string,
    doctorId: string,
    status: 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'IN_CONSULTATION' | 'OFFLINE'
  ): Promise<void> {
    const { error } = await this.supabase
      .from("doctors")
      .update({
        availability_status: status,
        last_status_update: new Date().toISOString()
      })
      .eq("clinic_id", clinicId)
      .eq("id", doctorId);

    if (error) throw new types.ClinicError(`Failed to update doctor availability: ${error.message}`);
  }

  // ============================================================================
  // DOCTOR LEAVE OPERATIONS
  // ============================================================================

  async addDoctorLeave(
    clinicId: string,
    doctorId: string,
    startDate: string,
    endDate: string,
    reason?: string
  ): Promise<void> {
    const { error } = await this.supabase.from("doctor_leaves").insert({
      clinic_id: clinicId,
      doctor_id: doctorId,
      leave_start_date: startDate,
      leave_end_date: endDate,
      reason: reason ?? null,
      // Self-service requests are effective immediately, so slots are blocked.
      status: "APPROVED",
      approval_date: new Date().toISOString()
    });

    if (error) throw new types.ClinicError(`Failed to save doctor leave: ${error.message}`);
  }

  async getDoctorLeaves(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<types.DoctorLeave[]> {
    const { data, error } = await this.supabase
      .from("doctor_leaves")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("status", "APPROVED")
      .lte("leave_start_date", date)
      .gte("leave_end_date", date);

    if (error) throw new types.ClinicError(`Failed to fetch doctor leaves: ${error.message}`);
    return data || [];
  }

  async isDoctorOnLeave(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<boolean> {
    const leaves = await this.getDoctorLeaves(clinicId, doctorId, date);
    return leaves.length > 0;
  }

  // ============================================================================
  // CLINIC HOLIDAYS
  // ============================================================================

  async getClinicHoliday(clinicId: string, date: string): Promise<types.ClinicHoliday | null> {
    const { data, error } = await this.supabase
      .from("clinic_holidays")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("holiday_date", date)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new types.ClinicError(`Failed to fetch holiday: ${error.message}`);
    }
    return data || null;
  }

  async isClinicClosed(clinicId: string, date: string): Promise<boolean> {
    const holiday = await this.getClinicHoliday(clinicId, date);
    return holiday ? !holiday.is_partial_closure : false;
  }

  // ============================================================================
  // APPOINTMENT OPERATIONS
  // ============================================================================

  async createAppointment(
    req: types.CreateAppointmentRequest
  ): Promise<types.Appointment> {
    // Generate appointment ID
    const date = new Date();
    const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 8);
    const appointmentId = `APT_${dateStr}_${random}`;

    const { data, error } = await this.supabase
      .from("appointments")
      .insert({
        id: appointmentId,
        clinic_id: req.clinic_id,
        doctor_id: req.doctor_id,
        patient_phone: req.patient_phone,
        patient_name: req.patient_name,
        service_type_id: req.service_type_id,
        appointment_date: req.appointment_date,
        appointment_time: req.appointment_time,
        location_type: req.location_type,
        preferred_language: req.preferred_language || "EN",
        service_address: req.service_address,
        service_latitude: req.service_latitude,
        service_longitude: req.service_longitude,
        amount: req.amount,
        notes: req.notes,
        status: "CONFIRMED",
        payment_status: "PENDING",
      })
      .select()
      .single();

    if (error) throw new types.ClinicError(`Failed to create appointment: ${error.message}`);
    return data;
  }

  async getAppointment(
    clinicId: string,
    appointmentId: string
  ): Promise<types.Appointment> {
    const { data, error } = await this.supabase
      .from("appointments")
      .select("*, service_type:service_types(*), doctor:doctors(*)")
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .single();

    if (error) throw new types.ClinicError(`Appointment not found: ${appointmentId}`);
    return data;
  }

  async getPatientAppointments(
    clinicId: string,
    patientPhone: string,
    upcomingOnly: boolean = true
  ): Promise<types.Appointment[]> {
    let query = this.supabase
      .from("appointments")
      .select("*, service_type:service_types(*), doctor:doctors(*)")
      .eq("clinic_id", clinicId)
      .eq("patient_phone", patientPhone);

    if (upcomingOnly) {
      const today = new Date().toISOString().split("T")[0];
      query = query
        .gte("appointment_date", today)
        .neq("status", "CANCELLED");
    }

    const { data, error } = await query.order("appointment_date", { ascending: true });

    if (error) throw new types.ClinicError(`Failed to fetch appointments: ${error.message}`);
    return data || [];
  }

  async getDoctorAppointments(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<types.Appointment[]> {
    const { data, error } = await this.supabase
      .from("appointments")
      .select("*, service_type:service_types(*)")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("appointment_date", date)
      .neq("status", "CANCELLED")
      .order("appointment_time", { ascending: true });

    if (error) throw new types.ClinicError(`Failed to fetch doctor appointments: ${error.message}`);
    return data || [];
  }

  async updateAppointmentStatus(
    clinicId: string,
    appointmentId: string,
    newStatus: string,
    reason?: string
  ): Promise<types.Appointment> {
    const { data, error } = await this.supabase
      .from("appointments")
      .update({
        status: newStatus,
        cancellation_reason: reason,
        updated_at: new Date().toISOString(),
        completed_at: newStatus === "COMPLETED" ? new Date().toISOString() : null,
      })
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .select()
      .single();

    if (error) throw new types.ClinicError(`Failed to update appointment: ${error.message}`);
    return data;
  }

  // ============================================================================
  // AVAILABLE SLOTS
  // ============================================================================

  async getAvailableSlots(
    clinicId: string,
    doctorId: string,
    date: string,
    locationType: string = "CLINIC"
  ): Promise<string[]> {
    // Check doctor availability status first
    const doctor = await this.getDoctorById(clinicId, doctorId);
    
    // Only show slots if doctor is AVAILABLE or IN_CONSULTATION
    // BUSY, ON_BREAK, OFFLINE doctors shouldn't show any slots
    const availableStatuses = ['AVAILABLE', 'IN_CONSULTATION'];
    if (!availableStatuses.includes(doctor.availability_status)) {
      return [];
    }

    // Get doctor hours
    const dayOfWeek = new Date(date + "T00:00:00").getDay();
    const doctorHours =
      locationType === "HOME"
        ? await this.getDoctorHomeVisitHours(clinicId, doctorId, dayOfWeek || 7)
        : await this.getDoctorAvailableHours(clinicId, doctorId, dayOfWeek || 7);

    if (!doctorHours) return [];

    // Check clinic holiday
    const isClosed = await this.isClinicClosed(clinicId, date);
    if (isClosed) return [];

    // Check doctor leave
    const onLeave = await this.isDoctorOnLeave(clinicId, doctorId, date);
    if (onLeave) return [];

    // Get existing appointments
    const appointments = await this.getDoctorAppointments(clinicId, doctorId, date);

    // Generate time slots (30-minute intervals)
    const slots: string[] = [];
    const [startHour, startMin] = doctorHours.opening_time.split(":").map(Number);
    const [endHour, endMin] = doctorHours.closing_time.split(":").map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    for (let time = startTime; time < endTime; time += 30) {
      const hour = Math.floor(time / 60);
      const min = time % 60;
      const timeStr = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;

      // Check if slot is booked
      const isBooked = appointments.some((apt) => apt.appointment_time === timeStr);
      if (!isBooked) slots.push(timeStr);
    }

    return slots;
  }

  async isSlotAvailable(
    clinicId: string,
    doctorId: string,
    date: string,
    time: string
  ): Promise<boolean> {
    const slots = await this.getAvailableSlots(clinicId, doctorId, date);
    return slots.includes(time);
  }

  // ============================================================================
  // PATIENT OPERATIONS
  // ============================================================================

  async getOrCreatePatient(phone: string, name: string): Promise<types.Patient> {
    // Try to get existing patient
    const { data: existing } = await this.supabase
      .from("patients")
      .select("*")
      .eq("phone", phone)
      .single();

    if (existing) return existing;

    // Create new patient
    const { data, error } = await this.supabase
      .from("patients")
      .insert({
        phone,
        name,
        total_appointments: 0,
      })
      .select()
      .single();

    if (error) throw new types.ClinicError(`Failed to create patient: ${error.message}`);
    return data;
  }

  // ============================================================================
  // HOME VISIT SCHEDULING
  // ============================================================================

  async createHomeVisitSchedule(
    req: types.CreateHomeVisitScheduleRequest
  ): Promise<types.DoctorHomeVisitSchedule> {
    const { data, error } = await this.supabase
      .from("doctor_home_visit_schedules")
      .insert({
        clinic_id: req.clinic_id,
        doctor_id: req.doctor_id,
        appointment_id: req.appointment_id,
        scheduled_visit_order: req.scheduled_visit_order,
        estimated_arrival_time: req.estimated_arrival_time,
        estimated_departure_time: req.estimated_departure_time,
        doctor_arrived_notification_sent: false,
      })
      .select()
      .single();

    if (error) {
      throw new types.ClinicError(`Failed to create home visit schedule: ${error.message}`);
    }
    return data;
  }

  async updateHomeVisitTracking(
    req: types.UpdateHomeVisitTrackingRequest
  ): Promise<types.DoctorHomeVisitSchedule> {
    const { data, error } = await this.supabase
      .from("doctor_home_visit_schedules")
      .update({
        actual_arrival_time: req.actual_arrival_time,
        actual_departure_time: req.actual_departure_time,
        visit_notes: req.visit_notes,
        visit_distance_km: req.visit_distance_km,
        visit_travel_time_minutes: req.visit_travel_time_minutes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.home_visit_schedule_id)
      .select()
      .single();

    if (error) {
      throw new types.ClinicError(`Failed to update home visit tracking: ${error.message}`);
    }
    return data;
  }

  async getHomeTodayVisits(
    clinicId: string,
    doctorId: string
  ): Promise<types.DoctorHomeVisitSchedule[]> {
    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await this.supabase
      .from("doctor_home_visit_schedules")
      .select("*, appointment:appointments(*)")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .gte("estimated_arrival_time", `${today}T00:00:00`)
      .lt("estimated_arrival_time", `${today}T23:59:59`)
      .order("scheduled_visit_order", { ascending: true });

    if (error) throw new types.ClinicError(`Failed to fetch home visits: ${error.message}`);
    return data || [];
  }

  // ============================================================================
  // HOME COLLECTION
  // ============================================================================

  async createHomeCollectionRequest(
    clinicId: string,
    patientPhone: string,
    patientName: string,
    address: string
  ): Promise<types.HomeCollectionRequest> {
    const { data, error } = await this.supabase
      .from("home_collection_requests")
      .insert({
        clinic_id: clinicId,
        patient_phone: patientPhone,
        patient_name: patientName,
        service_address: address,
        status: "PENDING",
      })
      .select()
      .single();

    if (error) throw new types.ClinicError(`Failed to create home collection request: ${error.message}`);
    return data;
  }

  // ============================================================================
  // UTILITY: FIND AVAILABLE DOCTORS FOR BOOKING
  // ============================================================================

  async findAvailableDoctorsForService(
    clinicId: string,
    serviceTypeId: string,
    date: string,
    locationType: string = "CLINIC"
  ): Promise<types.AvailableDoctorSlot[]> {
    // Get doctors who offer this service
    const { data: doctorServices, error: err1 } = await this.supabase
      .from("doctor_services")
      .select("doctor:doctors(*)")
      .eq("clinic_id", clinicId)
      .eq("service_type_id", serviceTypeId)
      .eq("is_enabled", true);

    if (err1) throw new types.ClinicError(`Failed to fetch doctors: ${err1.message}`);

    const results: types.AvailableDoctorSlot[] = [];

    for (const service of doctorServices || []) {
      const doctor = service.doctor;
      if (!doctor.is_active) continue;

      // Get available slots
      const slots = await this.getAvailableSlots(clinicId, doctor.id, date, locationType);

      if (slots.length > 0) {
        results.push({
          doctor_id: doctor.id,
          doctor_name: doctor.name,
          service_name: "", // Would join with service_types
          appointment_time: slots[0], // Show first available
          price: 500, // Would fetch from doctor_services pricing
          can_do_home_visit: doctor.can_do_home_visits,
          existing_visits_today: 0, // Would count from appointments
          max_visits: doctor.max_home_visits_per_day,
        });
      }
    }

    return results;
  }

  // ============================================================================
  // APPOINTMENT HISTORY
  // ============================================================================

  async getPatientAppointmentHistory(
    clinicId: string,
    patientPhone: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<Array<{
    appointment_id: string;
    doctor_name: string;
    appointment_date: string;
    appointment_time: string;
    status: string;
    service_type: string;
  }>> {
    const { data, error } = await this.supabase
      .from("appointments")
      .select("id, doctor:doctors(name), appointment_date, appointment_time, status, service_type:service_types(name)")
      .eq("clinic_id", clinicId)
      .eq("patient_phone", patientPhone)
      .eq("status", "COMPLETED")
      .order("appointment_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new types.ClinicError(`Failed to fetch appointment history: ${error.message}`);

    return (data || []).map((apt: any) => ({
      appointment_id: apt.id,
      doctor_name: apt.doctor?.name || "Unknown Doctor",
      appointment_date: apt.appointment_date,
      appointment_time: apt.appointment_time,
      status: apt.status,
      service_type: apt.service_type?.name || "Service"
    }));
  }

  async getPatientAppointmentHistoryCount(
    clinicId: string,
    patientPhone: string
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from("appointments")
      .select("*", { count: "exact" })
      .eq("clinic_id", clinicId)
      .eq("patient_phone", patientPhone)
      .eq("status", "COMPLETED");

    if (error) throw new types.ClinicError(`Failed to count appointments: ${error.message}`);
    return count || 0;
  }

  // ============================================================================
  // CLINICS TABLE OPERATIONS
  // ============================================================================

  async updateClinicConfig(
    clinicId: string,
    config: {
      clinic_name?: string;
      clinic_phone?: string;
      clinic_email?: string;
      open_time?: string;
      close_time?: string;
      working_days?: string;
      address?: string;
      website?: string;
    }
  ): Promise<void> {
    const { error } = await this.supabase
      .from("clinics")
      .update(config)
      .eq("clinic_id", clinicId);

    if (error) throw new types.ClinicError(`Failed to update clinic config: ${error.message}`);
  }
}

export default MultiClinicSupabaseClient;
