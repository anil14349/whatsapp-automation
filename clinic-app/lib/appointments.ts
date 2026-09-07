import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppointmentStatus,
  Database
} from "@/lib/supabase/database.types";
import type { CalendarPort } from "@/lib/calendar/types";
import { getDoctorById } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { registerPatientForBooking } from "@/lib/patients";
import { combineDateAndTime, isValidISODate } from "@/lib/scheduling/dates";

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
  calendar: CalendarPort,
  params: BookAppointmentParams
): Promise<AppointmentResult> {
  const { doctorId, dateString, patientName, patientPhone, timezone } = params;

  if (!isValidISODate(dateString)) {
    return { success: false, message: "Invalid appointment date." };
  }

  const time24 = normalizeTimeInput(params.timeString);

  if (!time24) {
    return { success: false, message: "Invalid appointment time." };
  }

  const doctor = await getDoctorById(supabase, doctorId);

  if (!doctor || !doctor.calendar_id) {
    return { success: false, message: "Doctor not found." };
  }

  const startTime = combineDateAndTime(dateString, time24, timezone);
  const endTime = new Date(
    startTime.getTime() + doctor.appointment_duration_minutes * 60_000
  );

  if (startTime.getTime() <= Date.now()) {
    return { success: false, message: "Appointment time must be in the future." };
  }

  const availableSlots = await getAvailableSlotsForDoctor(supabase, calendar, {
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

  let event;

  try {
    event = await calendar.createEvent(doctor.calendar_id, {
      title: `Appointment - ${patientName}`,
      start: startTime,
      end: endTime,
      description: `Doctor: ${doctor.name}\nPatient: ${patientName}`,
      location: doctor.clinic_name
    });
  } catch (error) {
    throw new Error(
      `Failed to create Calendar event: ${error instanceof Error ? error.message : String(error)}`
    );
  }

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
        status: "Confirmed",
        calendar_event_id: event.id
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

    // Any other failure (including the double-booking / one-active-
    // appointment constraints firing on a genuine race) rolls back the
    // Calendar event so we never leave an orphaned event with no
    // appointment record behind it.
    try {
      await calendar.deleteEvent(doctor.calendar_id, event.id);
    } catch (rollbackError) {
      console.error("Failed to roll back Calendar event after booking failure.", rollbackError);
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
  calendar: CalendarPort,
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

  const doctor = await getDoctorById(supabase, appointment.doctor_id);

  if (doctor?.calendar_id && appointment.calendar_event_id) {
    try {
      await calendar.deleteEvent(doctor.calendar_id, appointment.calendar_event_id);
    } catch (calendarError) {
      return {
        success: false,
        message: "Could not remove the Calendar event; appointment was not cancelled."
      };
    }
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
  calendar: CalendarPort,
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

  if (!doctor || !doctor.calendar_id) {
    return { success: false, message: "Doctor calendar not found." };
  }

  const newStartTime = combineDateAndTime(params.newDateString, time24, params.timezone);
  const newEndTime = new Date(
    newStartTime.getTime() + doctor.appointment_duration_minutes * 60_000
  );

  const isSameSlot =
    params.newDateString === appointment.appointment_date &&
    time24 === appointment.appointment_time;

  if (!isSameSlot) {
    const availableSlots = await getAvailableSlotsForDoctor(supabase, calendar, {
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

  let newEvent;

  try {
    newEvent = await calendar.createEvent(doctor.calendar_id, {
      title: `Appointment - ${appointment.patient_name}`,
      start: newStartTime,
      end: newEndTime,
      description: `Doctor: ${doctor.name}\nPatient: ${appointment.patient_name}`,
      location: doctor.clinic_name
    });
  } catch (calendarError) {
    return { success: false, message: "Unable to reserve the new Calendar slot." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("appointments")
    .update({
      appointment_date: params.newDateString,
      appointment_time: time24,
      calendar_event_id: newEvent.id
    })
    .eq("id", params.appointmentId)
    .select()
    .single();

  if (updateError) {
    // Roll back the newly created event since the row update failed —
    // otherwise we'd leak a Calendar event with nothing pointing at it.
    try {
      await calendar.deleteEvent(doctor.calendar_id, newEvent.id);
    } catch (rollbackError) {
      console.error("Failed to roll back new Calendar event after reschedule failure.", rollbackError);
    }

    if (updateError.code === UNIQUE_VIOLATION) {
      return {
        success: false,
        message: "You already have another active appointment on that date."
      };
    }

    return { success: false, message: "Unable to complete reschedule." };
  }

  // Old Calendar event is deleted only after the row update has
  // succeeded — mirrors the ordering the Apps Script version settled on
  // (see README: "Delete old event only after the sheet has been
  // updated"), so a crash between these two steps leaves the *new*
  // event as the source of truth, not a dangling old one with no record.
  if (appointment.calendar_event_id) {
    try {
      await calendar.deleteEvent(doctor.calendar_id, appointment.calendar_event_id);
    } catch (cleanupError) {
      console.error("Failed to delete old Calendar event after reschedule.", cleanupError);
    }
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
    // Exact match is fine here: patient_phone is stored as entered by
    // upsertPatient (which normalizes it), and every caller passes the
    // same normalized value used at booking time.
    if (appointment.patient_phone !== options.patientPhone) {
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
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_phone", phone)
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
