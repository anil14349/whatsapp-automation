import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppointmentStatus,
  Database
} from "@/lib/supabase/database.types";
import { getDoctorById } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { registerPatientForBooking } from "@/lib/patients";
import { combineDateAndTime, isValidISODate } from "@/lib/scheduling/dates";
import { normalizeWhatsAppPhone, phonesMatch } from "@/lib/phone";

/**
 * Book/cancel/reschedule. Ports the core of src/Model_Appointments.gs.
 *
 * Where the Apps Script version used LockService + an app-level
 * "scan for conflicts" check to prevent double-booking (a best-effort
 * guard — see supabase/migrations/0003_no_double_booking.sql's comment),
 * this version relies on real unique constraints for the actual
 * guarantee, and only does an app-level pre-check to turn what would
 * otherwise be a raw constraint-violation error into a friendly message
 * in the common case.
 */

export type Appointment = Database["public"]["Tables"]["appointments"]["Row"];

export interface BookAppointmentParams {
  doctorId: string;
  dateString: string; // "YYYY-MM-DD"
  timeString: string; // "HH:MM" (24h) or "HH:MM AM/PM"
  patientName: string;
  patientPhone: string;
  patientLanguage?: string;
  timezone: string;
}

export interface AppointmentResult {
  success: boolean;
  message: string;
  appointment?: Appointment;
}

const UNIQUE_VIOLATION = "23505";

function generateAppointmentCode(): string {
  return "A" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Accepts "HH:MM" (24h) or "9:00 AM"/"09:00 am" and normalizes to "HH:MM". */
export function normalizeTimeInput(timeString: string): string | null {
  const trimmed = timeString.trim();

  const twentyFourHour = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (twentyFourHour) {
    const [, h, m] = twentyFourHour;
    return `${h!.padStart(2, "0")}:${m}`;
  }

  const twelveHour = /^(\d{1,2}):([0-5]\d)\s*(am|pm)$/i.exec(trimmed);
  if (twelveHour) {
    const [, hRaw, m, meridiem] = twelveHour;
    let hour = Number(hRaw);

    if (hour < 1 || hour > 12) {
      return null;
    }

    if (meridiem!.toLowerCase() === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }

    return `${String(hour).padStart(2, "0")}:${m}`;
  }

  return null;
}

export async function bookAppointment(
  supabase: SupabaseClient<Database>,
  params: BookAppointmentParams
): Promise<AppointmentResult> {
  const { doctorId, dateString, patientName, timezone } = params;

  // Normalize once at the root so every caller (WhatsApp senders arriving
  // pre-formatted with a country code, the native WhatsApp Flow endpoint,
  // and free-typed admin/receptionist walk-in input) ends up comparing
  // and storing the same last-10-digit form patients.phone already uses
  // (see lib/phone.ts) — otherwise the same real number in two different
  // formats looks like two different patients to the same-day-duplicate
  // check and the appointments_one_active_per_patient_per_day_idx
  // constraint, even though patients.phone resolves them to one row.
  const patientPhone = normalizeWhatsAppPhone(params.patientPhone);

  if (!patientPhone) {
    return { success: false, message: "A valid patient phone number is required." };
  }

  if (!isValidISODate(dateString)) {
    return { success: false, message: "Invalid appointment date." };
  }

  const time24 = normalizeTimeInput(params.timeString);

  if (!time24) {
    return { success: false, message: "Invalid appointment time." };
  }

  const doctor = await getDoctorById(supabase, doctorId);

  if (!doctor) {
    return { success: false, message: "Doctor not found." };
  }

  const startTime = combineDateAndTime(dateString, time24, timezone);

  if (startTime.getTime() <= Date.now()) {
    return { success: false, message: "Appointment time must be in the future." };
  }

  const availableSlots = await getAvailableSlotsForDoctor(supabase, {
    doctor,
    dateString,
    timezone
  });

  const isSlotOffered = availableSlots.some(
    (slot) => slot.getTime() === startTime.getTime()
  );

  if (!isSlotOffered) {
    return { success: false, message: "The selected appointment time is not available." };
  }

  // Friendly pre-check; the unique index is the real guarantee (see
  // migration 0004) for the rare race where two requests land between
  // this check and the insert below.
  const { data: activeSameDay, error: activeSameDayError } = await supabase
    .from("appointments")
    .select("id")
    .eq("patient_phone", patientPhone)
    .eq("appointment_date", dateString)
    .eq("status", "Confirmed")
    .maybeSingle();

  if (activeSameDayError) {
    throw new Error(`Failed to check existing appointments: ${activeSameDayError.message}`);
  }

  if (activeSameDay) {
    return {
      success: false,
      message: "You already have an active appointment on this date."
    };
  }

  const patientResult = await registerPatientForBooking(
    supabase,
    patientPhone,
    patientName,
    params.patientLanguage
  );

  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("appointments")
      .insert({
        appointment_code: generateAppointmentCode(),
        doctor_id: doctor.id,
        patient_id: patientResult.patient.id,
        patient_name: patientName,
        patient_phone: patientPhone,
        appointment_date: dateString,
        appointment_time: time24,
        status: "Confirmed"
      })
      .select()
      .single();

    if (!error) {
      return {
        success: true,
        message: "Appointment booked successfully.",
        appointment: data
      };
    }

    const isRetryableCollision =
      error.code === UNIQUE_VIOLATION && error.message.includes("appointment_code");

    if (isRetryableCollision && attempt < MAX_ATTEMPTS) {
      continue;
    }

    if (error.code === UNIQUE_VIOLATION) {
      return {
        success: false,
        message: "This appointment slot is no longer available. Please choose another."
      };
    }

    return { success: false, message: "Unable to save appointment. No booking was created." };
  }

  throw new Error("Unreachable: booking loop exited without returning.");
}

/**
 * Doctor-only: marks a Confirmed appointment Completed or No-Show.
 * Shared by the admin UI (app/admin/(dashboard)/appointments/actions.ts)
 * and the WhatsApp Doctor Portal (lib/whatsapp/doctorFlow.ts) — one
 * status-transition rule, not two copies that could drift.
 */
export async function markAppointmentStatus(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  doctorId: string,
  status: Extract<AppointmentStatus, "Completed" | "No-Show">
): Promise<AppointmentResult> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("doctor_id", doctorId) // fail-closed ownership, same pattern as cancelAppointment
    .in("status", ["Confirmed"])
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update appointment status: ${error.message}`);
  }

  if (!data) {
    return {
      success: false,
      message: "Appointment not found, not yours, or no longer Confirmed."
    };
  }

  return { success: true, message: `Marked as ${status}.`, appointment: data };
}

export interface CancelAppointmentOptions {
  /** Set when a doctor is cancelling on a patient's behalf via the doctor portal. */
  authorizedDoctorId?: string;
  /** Set when a patient is cancelling their own appointment. */
  patientPhone?: string;
}

function isInactiveStatus(status: AppointmentStatus): boolean {
  return status === "Cancelled" || status === "Completed" || status === "No-Show";
}

export async function cancelAppointment(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  options: CancelAppointmentOptions
): Promise<AppointmentResult> {
  const { data: appointment, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load appointment: ${error.message}`);
  }

  if (!appointment) {
    return { success: false, message: "Appointment not found." };
  }

  const authError = checkAppointmentOwnership(appointment, options);
  if (authError) {
    return authError;
  }

  if (isInactiveStatus(appointment.status)) {
    return {
      success: false,
      message:
        appointment.status === "Cancelled"
          ? "Appointment is already cancelled."
          : `Appointment is already marked as ${appointment.status}.`
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("appointments")
    .update({ status: "Cancelled" })
    .eq("id", appointmentId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to cancel appointment: ${updateError.message}`);
  }

  return { success: true, message: "Appointment cancelled successfully.", appointment: updated };
}

export interface RescheduleAppointmentParams {
  appointmentId: string;
  newDateString: string;
  newTimeString: string;
  timezone: string;
  authorizedDoctorId?: string;
  patientPhone?: string;
}

export async function rescheduleAppointment(
  supabase: SupabaseClient<Database>,
  params: RescheduleAppointmentParams
): Promise<AppointmentResult> {
  const { data: appointment, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", params.appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load appointment: ${error.message}`);
  }

  if (!appointment) {
    return { success: false, message: "Appointment not found." };
  }

  const authError = checkAppointmentOwnership(appointment, params);
  if (authError) {
    return authError;
  }

  if (isInactiveStatus(appointment.status)) {
    return {
      success: false,
      message:
        appointment.status === "Cancelled"
          ? "Cancelled appointments cannot be rescheduled."
          : `Appointments marked as ${appointment.status} cannot be rescheduled.`
    };
  }

  if (!isValidISODate(params.newDateString)) {
    return { success: false, message: "Invalid new appointment date." };
  }

  const time24 = normalizeTimeInput(params.newTimeString);
  if (!time24) {
    return { success: false, message: "Invalid new appointment time." };
  }

  const doctor = await getDoctorById(supabase, appointment.doctor_id);

  if (!doctor) {
    return { success: false, message: "Doctor not found." };
  }

  const newStartTime = combineDateAndTime(params.newDateString, time24, params.timezone);

  const isSameSlot =
    params.newDateString === appointment.appointment_date &&
    time24 === appointment.appointment_time;

  if (!isSameSlot) {
    const availableSlots = await getAvailableSlotsForDoctor(supabase, {
      doctor,
      dateString: params.newDateString,
      timezone: params.timezone
    });

    const isSlotOffered = availableSlots.some(
      (slot) => slot.getTime() === newStartTime.getTime()
    );

    if (!isSlotOffered) {
      return { success: false, message: "The selected time is not available." };
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("appointments")
    .update({
      appointment_date: params.newDateString,
      appointment_time: time24
    })
    .eq("id", params.appointmentId)
    .select()
    .single();

  if (updateError) {
    if (updateError.code === UNIQUE_VIOLATION) {
      return {
        success: false,
        message: "You already have another active appointment on that date."
      };
    }

    return { success: false, message: "Unable to complete reschedule." };
  }

  return { success: true, message: "Appointment rescheduled successfully.", appointment: updated };
}

export function checkAppointmentOwnership(
  appointment: Appointment,
  options: { authorizedDoctorId?: string; patientPhone?: string }
): AppointmentResult | null {
  if (options.authorizedDoctorId) {
    if (appointment.doctor_id !== options.authorizedDoctorId) {
      return { success: false, message: "Appointment does not belong to this doctor." };
    }

    return null;
  }

  if (options.patientPhone) {
    // Compare via phonesMatch (normalizes both sides to the last 10
    // digits) rather than a raw string match: bookAppointment now stores
    // patient_phone normalized, but rows written before that fix (or by
    // any caller that didn't go through it) may still hold the raw
    // as-sent format, and the caller's options.patientPhone can arrive in
    // either form too (e.g. ctx.phone from WhatsApp). A strict `!==`
    // would wrongly deny ownership for the exact same real number.
    if (!phonesMatch(appointment.patient_phone, options.patientPhone)) {
      return { success: false, message: "Appointment does not belong to this phone number." };
    }

    return null;
  }

  // Fail closed: neither an authorized doctor nor a matching patient
  // phone was supplied — this mirrors the fail-closed fix already made
  // to updateAppointmentStatus in the Apps Script version (see README
  // "Reliability & security hardening"). Never allow an unauthenticated
  // caller through by omission.
  return { success: false, message: "Not authorized to modify this appointment." };
}

// ------------------------------------------------------------------
// Listing
// ------------------------------------------------------------------

export async function getConfirmedAppointmentsForPhone(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<Appointment[]> {
  // Normalize so this matches whatever format bookAppointment now stores
  // (last 10 digits) regardless of how the caller's phone arrived. Note:
  // this won't find appointments written before this fix whose
  // patient_phone still holds the raw pre-normalization format — see the
  // backfill note on bookAppointment.
  const normalizedPhone = normalizeWhatsAppPhone(phone);

  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_phone", normalizedPhone)
    .eq("status", "Confirmed")
    .order("appointment_date")
    .order("appointment_time");

  if (error) {
    throw new Error(`Failed to load appointments: ${error.message}`);
  }

  return data;
}

export async function getDoctorConfirmedAppointments(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  options: { fromDate?: string; toDate?: string } = {}
): Promise<Appointment[]> {
  let query = supabase
    .from("appointments")
    .select("*")
    .eq("doctor_id", doctorId)
    .eq("status", "Confirmed");

  if (options.fromDate) {
    query = query.gte("appointment_date", options.fromDate);
  }

  if (options.toDate) {
    query = query.lte("appointment_date", options.toDate);
  }

  const { data, error } = await query.order("appointment_date").order("appointment_time");

  if (error) {
    throw new Error(`Failed to load doctor appointments: ${error.message}`);
  }

  return data;
}

/**
 * Edit appointment time (same date, different time slot).
 * Validates the new time slot is available before updating.
 */
export async function updateAppointmentTime(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  doctorId: string,
  newTimeString: string,
  timezone: string
): Promise<AppointmentResult> {
  // Get current appointment
  const { data: currentAppt, error: fetchError } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .single();

  if (fetchError || !currentAppt) {
    return { success: false, message: "Appointment not found." };
  }

  if (currentAppt.status !== "Confirmed") {
    return { success: false, message: "Can only edit time for Confirmed appointments." };
  }

  if (currentAppt.doctor_id !== doctorId) {
    return { success: false, message: "Doctor mismatch." };
  }

  // Normalize time
  const normalizedTime = normalizeTimeInput(newTimeString);
  if (!normalizedTime) {
    return { success: false, message: "Invalid time format. Use HH:MM or HH:MM AM/PM." };
  }

  // Check availability for new time
  const doctor = await getDoctorById(supabase, doctorId);
  if (!doctor) {
    return { success: false, message: "Doctor not found." };
  }

  const availableSlots = await getAvailableSlotsForDoctor(supabase, {
    doctor,
    dateString: currentAppt.appointment_date,
    timezone
  });

  const newSlotDateTime = combineDateAndTime(currentAppt.appointment_date, normalizedTime, timezone);
  const isAvailable = availableSlots.some(
    (slot) => slot.toISOString() === newSlotDateTime.toISOString()
  );

  if (!isAvailable) {
    return { success: false, message: "Time slot is no longer available." };
  }

  // Update appointment
  const { error: updateError } = await supabase
    .from("appointments")
    .update({ appointment_time: normalizedTime })
    .eq("id", appointmentId);

  if (updateError) {
    return { success: false, message: `Failed to update appointment: ${updateError.message}` };
  }

  // Log change
  await logAuditEvent(supabase, {
    appointmentId,
    action: "TIME_UPDATED",
    oldValue: currentAppt.appointment_time,
    newValue: normalizedTime
  });

  return { success: true, message: "Appointment time updated successfully." };
}

/**
 * Edit appointment date and/or time.
 * Validates the new slot is available before updating.
 */
export async function updateAppointmentDateTime(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  doctorId: string,
  newDateString: string,
  newTimeString: string,
  timezone: string
): Promise<AppointmentResult> {
  // Get current appointment
  const { data: currentAppt, error: fetchError } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .single();

  if (fetchError || !currentAppt) {
    return { success: false, message: "Appointment not found." };
  }

  if (currentAppt.status !== "Confirmed") {
    return { success: false, message: "Can only edit date/time for Confirmed appointments." };
  }

  if (currentAppt.doctor_id !== doctorId) {
    return { success: false, message: "Doctor mismatch." };
  }

  // Validate date
  if (!isValidISODate(newDateString)) {
    return { success: false, message: "Invalid date format. Use YYYY-MM-DD." };
  }

  // Check date is not in the past
  const newDate = new Date(newDateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (newDate < today) {
    return { success: false, message: "Cannot schedule appointment in the past." };
  }

  // Normalize time
  const normalizedTime = normalizeTimeInput(newTimeString);
  if (!normalizedTime) {
    return { success: false, message: "Invalid time format. Use HH:MM or HH:MM AM/PM." };
  }

  // Check availability for new date/time
  const doctor = await getDoctorById(supabase, doctorId);
  if (!doctor) {
    return { success: false, message: "Doctor not found." };
  }

  const availableSlots = await getAvailableSlotsForDoctor(supabase, {
    doctor,
    dateString: newDateString,
    timezone
  });

  const newSlotDateTime = combineDateAndTime(newDateString, normalizedTime, timezone);
  const isAvailable = availableSlots.some(
    (slot) => slot.toISOString() === newSlotDateTime.toISOString()
  );

  if (!isAvailable) {
    return { success: false, message: "Time slot is not available for the selected date." };
  }

  // Check one-active-per-patient-per-day constraint for new date
  const { data: existingAppts } = await supabase
    .from("appointments")
    .select("id")
    .eq("patient_id", currentAppt.patient_id)
    .eq("appointment_date", newDateString)
    .eq("status", "Confirmed")
    .neq("id", appointmentId);

  if (existingAppts && existingAppts.length > 0) {
    return {
      success: false,
      message: "Patient already has an appointment on this date."
    };
  }

  // Update appointment
  const { error: updateError } = await supabase
    .from("appointments")
    .update({
      appointment_date: newDateString,
      appointment_time: normalizedTime
    })
    .eq("id", appointmentId);

  if (updateError) {
    return { success: false, message: `Failed to update appointment: ${updateError.message}` };
  }

  // Log changes
  if (currentAppt.appointment_date !== newDateString) {
    await logAuditEvent(supabase, {
      appointmentId,
      action: "DATE_UPDATED",
      oldValue: currentAppt.appointment_date,
      newValue: newDateString
    });
  }

  if (currentAppt.appointment_time !== normalizedTime) {
    await logAuditEvent(supabase, {
      appointmentId,
      action: "TIME_UPDATED",
      oldValue: currentAppt.appointment_time,
      newValue: normalizedTime
    });
  }

  return { success: true, message: "Appointment updated successfully." };
}

/**
 * Change appointment doctor (to different specialist).
 * Validates new doctor/time slot is available.
 */
export async function changeAppointmentDoctor(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  oldDoctorId: string,
  newDoctorId: string,
  newTimeString: string,
  timezone: string
): Promise<AppointmentResult> {
  // Get current appointment
  const { data: currentAppt, error: fetchError } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .single();

  if (fetchError || !currentAppt) {
    return { success: false, message: "Appointment not found." };
  }

  if (currentAppt.status !== "Confirmed") {
    return { success: false, message: "Can only change doctor for Confirmed appointments." };
  }

  if (currentAppt.doctor_id !== oldDoctorId) {
    return { success: false, message: "Doctor mismatch." };
  }

  // Validate new doctor exists
  const newDoctor = await getDoctorById(supabase, newDoctorId);
  if (!newDoctor) {
    return { success: false, message: "New doctor not found." };
  }

  // Normalize time
  const normalizedTime = normalizeTimeInput(newTimeString);
  if (!normalizedTime) {
    return { success: false, message: "Invalid time format. Use HH:MM or HH:MM AM/PM." };
  }

  // Check availability for new doctor/time
  const availableSlots = await getAvailableSlotsForDoctor(supabase, {
    doctor: newDoctor,
    dateString: currentAppt.appointment_date,
    timezone
  });

  const newSlotDateTime = combineDateAndTime(currentAppt.appointment_date, normalizedTime, timezone);
  const isAvailable = availableSlots.some(
    (slot) => slot.toISOString() === newSlotDateTime.toISOString()
  );

  if (!isAvailable) {
    return {
      success: false,
      message: "Time slot is not available for the selected doctor."
    };
  }

  // Update appointment
  const { error: updateError } = await supabase
    .from("appointments")
    .update({
      doctor_id: newDoctorId,
      appointment_time: normalizedTime
    })
    .eq("id", appointmentId);

  if (updateError) {
    return { success: false, message: `Failed to update appointment: ${updateError.message}` };
  }

  // Log changes
  await logAuditEvent(supabase, {
    appointmentId,
    action: "DOCTOR_CHANGED",
    oldValue: oldDoctorId,
    newValue: newDoctorId
  });

  if (currentAppt.appointment_time !== normalizedTime) {
    await logAuditEvent(supabase, {
      appointmentId,
      action: "TIME_UPDATED",
      oldValue: currentAppt.appointment_time,
      newValue: normalizedTime
    });
  }

  return { success: true, message: "Appointment doctor changed successfully." };
}

/**
 * Log audit event for appointment changes (for compliance/tracking).
 */
async function logAuditEvent(
  supabase: SupabaseClient<Database>,
  event: {
    appointmentId: string;
    action: string;
    oldValue: string;
    newValue: string;
  }
): Promise<void> {
  // Log to message_log with special marker
  await supabase.from("message_log").insert({
    sender_phone: "SYSTEM",
    message_type: "AUDIT",
    message_content: JSON.stringify({
      type: "appointment_edit",
      appointmentId: event.appointmentId,
      action: event.action,
      oldValue: event.oldValue,
      newValue: event.newValue,
      timestamp: new Date().toISOString()
    }),
    received_at: new Date().toISOString()
  });
}
