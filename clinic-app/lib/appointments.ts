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
