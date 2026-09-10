"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  bookAppointment,
  cancelAppointment,
  markAppointmentStatus,
  updateAppointmentTime,
  updateAppointmentDateTime,
  changeAppointmentDoctor
} from "@/lib/appointments";
import { getDoctorById } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { formatTimeLabel } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { assertAdminRole } from "@/lib/auth/authorize";
import { sendDoctorBroadcast } from "@/lib/broadcast";
import { updatePatientName } from "@/lib/patients";

/**
 * Admin cancellation goes through the same cancelAppointment() used by
 * the WhatsApp patient/doctor flows — same status-transition rules
 * (can't cancel an already-Completed/No-Show appointment, etc.) —
 * rather than a separate ad-hoc admin-only code path that could drift
 * from those rules over time.
 */
export async function adminCancelAppointmentAction(
  appointmentId: string,
  doctorId: string
): Promise<void> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();

  const result = await cancelAppointment(supabase, appointmentId, {
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

  const slots = await getAvailableSlotsForDoctor(supabase, {
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
 * database constraints, same patient upsert/registration — not a
 * separate ad-hoc "just insert a row" path that could drift from those
 * rules or actually double-book a doctor.
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

  const result = await bookAppointment(supabase, {
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

export interface BroadcastFormState {
  error?: string;
  success?: boolean;
  sent?: number;
  errors?: number;
  recipientCount?: number;
}

/**
 * Web-admin counterpart to the WhatsApp Doctor Portal's Broadcast option
 * (lib/whatsapp/doctorFlow.ts's DOCTOR_BROADCAST_* states) — same
 * sendDoctorBroadcast() call, so an admin/receptionist gets identical
 * behavior (dedup by phone, per-recipient try/catch, message_log rows)
 * without needing the doctor's own WhatsApp number.
 */
export async function broadcastToDoctorPatientsAction(
  _prevState: BroadcastFormState,
  formData: FormData
): Promise<BroadcastFormState> {
  const doctorId = String(formData.get("doctorId") ?? "").trim();
  const dateString = String(formData.get("date") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!doctorId || !dateString) {
    return { error: "Missing doctor or date filter." };
  }

  if (!message) {
    return { error: "Message can't be empty." };
  }

  try {
    await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
    const supabase = getSupabaseServerClient();
    const env = getServerEnv();

    const result = await sendDoctorBroadcast(supabase, doctorId, dateString, message, env.CLINIC_TIMEZONE);

    if (result.recipientCount === 0) {
      return { error: `No confirmed appointments for that doctor on ${dateString}.` };
    }

    return {
      success: true,
      sent: result.sent,
      errors: result.errors,
      recipientCount: result.recipientCount
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to send broadcast." };
  }
}

/**
 * Edit appointment time (same date, different slot)
 */
export async function editAppointmentTimeAction(
  appointmentId: string,
  doctorId: string,
  newTimeString: string
): Promise<{ success?: boolean; message: string }> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const result = await updateAppointmentTime(
    supabase,
    appointmentId,
    doctorId,
    newTimeString,
    env.CLINIC_TIMEZONE
  );

  if (result.success) {
    revalidatePath("/admin/appointments");
  }

  return { success: result.success, message: result.message };
}

/**
 * Edit appointment date and/or time
 */
export async function editAppointmentDateTimeAction(
  appointmentId: string,
  doctorId: string,
  newDateString: string,
  newTimeString: string
): Promise<{ success?: boolean; message: string }> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const result = await updateAppointmentDateTime(
    supabase,
    appointmentId,
    doctorId,
    newDateString,
    newTimeString,
    env.CLINIC_TIMEZONE
  );

  if (result.success) {
    revalidatePath("/admin/appointments");
  }

  return { success: result.success, message: result.message };
}

/**
 * Change appointment doctor
 */
export async function editAppointmentDoctorAction(
  appointmentId: string,
  oldDoctorId: string,
  newDoctorId: string,
  newTimeString: string
): Promise<{ success?: boolean; message: string }> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const result = await changeAppointmentDoctor(
    supabase,
    appointmentId,
    oldDoctorId,
    newDoctorId,
    newTimeString,
    env.CLINIC_TIMEZONE
  );

  if (result.success) {
    revalidatePath("/admin/appointments");
  }

  return { success: result.success, message: result.message };
}

/**
 * Edit patient name
 */
export async function editPatientNameAction(
  patientId: string,
  newName: string
): Promise<{ success?: boolean; message: string }> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);
  const supabase = getSupabaseServerClient();

  const result = await updatePatientName(supabase, patientId, newName);

  if (result.success) {
    revalidatePath("/admin/patients");
  }

  return { success: result.success, message: result.message };
}
