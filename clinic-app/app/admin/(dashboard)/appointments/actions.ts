"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GoogleCalendar } from "@/lib/calendar/google";
import { bookAppointment, cancelAppointment, markAppointmentStatus } from "@/lib/appointments";
import { getDoctorById } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { formatTimeLabel } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { assertAdminRole } from "@/lib/auth/authorize";

/**
 * Admin cancellation goes through the same cancelAppointment() used by
 * the WhatsApp patient/doctor flows — same Calendar cleanup, same
 * status-transition rules (can't cancel an already-Completed/No-Show
 * appointment, etc.) — rather than a separate ad-hoc admin-only code
 * path that could drift from those rules over time.
 */
export async function adminCancelAppointmentAction(
  appointmentId: string,
  doctorId: string
): Promise<void> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();
  const calendar = new GoogleCalendar();

  const result = await cancelAppointment(supabase, calendar, appointmentId, {
    authorizedDoctorId: doctorId
  });

  if (!result.success) {
    throw new Error(result.message);
  }

  revalidatePath("/admin/appointments");
}

export async function markAppointmentStatusAction(
  appointmentId: string,
  doctorId: string,
  status: "Completed" | "No-Show"
): Promise<void> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();

  const result = await markAppointmentStatus(supabase, appointmentId, doctorId, status);

  if (!result.success) {
    throw new Error(result.message);
  }

  revalidatePath("/admin/appointments");
}

/**
 * For the "New Appointment" walk-in form's time <select> — recomputes
 * the exact same availability the WhatsApp booking flow would offer for
 * this doctor/date (getAvailableSlotsForDoctor), so a receptionist can
 * never accidentally double-book a slot a patient could also book over
 * WhatsApp at the same moment. Returns the raw ISO instant as `value`
 * (fed back into createWalkInAppointmentAction unchanged — combined with
 * `bookAppointment`'s own re-check at submit time, this is "best effort,
 * not the only guard"; the real guarantee is still the
 * appointments_no_double_booking_idx database constraint) and a
 * human-readable `label`.
 */
export async function getAvailableSlotsAction(
  doctorId: string,
  dateString: string
): Promise<{ slots: Array<{ value: string; label: string }>; error?: string }> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);

  if (!doctorId || !dateString) {
    return { slots: [] };
  }

  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const doctor = await getDoctorById(supabase, doctorId);

  if (!doctor) {
    return { slots: [], error: "Doctor not found." };
  }

  const slots = await getAvailableSlotsForDoctor(supabase, new GoogleCalendar(), {
    doctor,
    dateString,
    timezone: env.CLINIC_TIMEZONE
  });

  return {
    slots: slots.map((slot) => ({
      value: slot.toISOString(),
      label: formatTimeLabel(slot, env.CLINIC_TIMEZONE)
    }))
  };
}

export interface WalkInFormState {
  error?: string;
  success?: boolean;
}

/**
 * Records a walk-in patient — someone who showed up at the hospital in
 * person rather than booking over WhatsApp. Goes through the exact same
 * bookAppointment() the WhatsApp flow and the native Flow form both use
 * (lib/appointments.ts) — same slot-availability re-check, same
 * one-active-appointment-per-patient-per-day and no-double-booking
 * database constraints, same patient upsert/registration and Calendar
 * sync — not a separate ad-hoc "just insert a row" path that could
 * drift from those rules or actually double-book a doctor.
 */
export async function createWalkInAppointmentAction(
  _prevState: WalkInFormState,
  formData: FormData
): Promise<WalkInFormState> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);

  const doctorId = String(formData.get("doctorId") ?? "").trim();
  const dateString = String(formData.get("date") ?? "").trim();
  const slotIso = String(formData.get("slot") ?? "").trim();
  const patientName = String(formData.get("patientName") ?? "").trim();
  // Digits only for basic input cleanup — a human typing a phone number
  // will inconsistently include spaces/dashes/parens ("987-654-3210" vs
  // "9876543210"). bookAppointment() itself now normalizes patientPhone
  // via lib/phone.ts's normalizeWhatsAppPhone (last 10 digits) before
  // comparing/storing it, so this free-typed input — unlike WhatsApp's
  // consistently country-code-prefixed sender phone — correctly matches
  // the same real patient's WhatsApp-originated appointments too (e.g.
  // "9876543210" here vs "919876543210" from a WhatsApp booking).
  const patientPhone = String(formData.get("patientPhone") ?? "").trim().replace(/\D/g, "");

  if (!doctorId || !dateString || !slotIso || !patientName || !patientPhone) {
    return { error: "Doctor, date, time slot, patient name, and phone are all required." };
  }

  const slotDate = new Date(slotIso);

  if (Number.isNaN(slotDate.getTime())) {
    return { error: "Please choose a time slot." };
  }

  const supabase = getSupabaseServerClient();
  const env = getServerEnv();
  const calendar = new GoogleCalendar();

  const result = await bookAppointment(supabase, calendar, {
    doctorId,
    dateString,
    timeString: formatTimeLabel(slotDate, env.CLINIC_TIMEZONE),
    patientName,
    patientPhone,
    timezone: env.CLINIC_TIMEZONE
  });

  if (!result.success) {
    return { error: result.message };
  }

  revalidatePath("/admin/appointments");
  return { success: true };
}
