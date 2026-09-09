"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createDoctor,
  updateDoctor,
  addDoctorAvailabilitySession,
  removeDoctorAvailabilitySession,
  addDoctorLeave,
  deactivateDoctorLeave
} from "@/lib/doctors";
import type { Weekday } from "@/lib/supabase/database.types";
import { assertAdminRole } from "@/lib/auth/authorize";

export interface FormState {
  error?: string;
}

export async function createDoctorAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  await assertAdminRole(["ADMIN"]);
  const doctorCode = String(formData.get("doctorCode") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const clinicName = String(formData.get("clinicName") ?? "").trim();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const whatsappPhone = String(formData.get("whatsappPhone") ?? "").trim();
  const specialization = String(formData.get("specialization") ?? "").trim();
  const durationMinutes = Number(formData.get("appointmentDurationMinutes") ?? 30);

  if (!doctorCode || !name) {
    return { error: "Doctor code and name are required." };
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return { error: "Appointment duration must be a positive number of minutes." };
  }

  try {
    const supabase = getSupabaseServerClient();

    await createDoctor(supabase, {
      doctor_code: doctorCode,
      name,
      clinic_name: clinicName,
      calendar_id: calendarId,
      whatsapp_phone: whatsappPhone,
      specialization,
      appointment_duration_minutes: durationMinutes,
      active: true
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create doctor." };
  }

  revalidatePath("/admin/doctors");
  return {};
}

export async function updateDoctorAction(
  doctorId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  await assertAdminRole(["ADMIN"]);
  const name = String(formData.get("name") ?? "").trim();
  const clinicName = String(formData.get("clinicName") ?? "").trim();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  const whatsappPhone = String(formData.get("whatsappPhone") ?? "").trim();
  const specialization = String(formData.get("specialization") ?? "").trim();
  const durationMinutes = Number(formData.get("appointmentDurationMinutes") ?? 30);
  const active = formData.get("active") === "on";

  if (!name) {
    return { error: "Name is required." };
  }

  try {
    const supabase = getSupabaseServerClient();

    await updateDoctor(supabase, doctorId, {
      name,
      clinic_name: clinicName,
      calendar_id: calendarId,
      whatsapp_phone: whatsappPhone,
      specialization,
      appointment_duration_minutes: durationMinutes,
      active
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update doctor." };
  }

  revalidatePath(`/admin/doctors/${doctorId}`);
  revalidatePath("/admin/doctors");
  return {};
}

export async function addAvailabilityAction(
  doctorId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  await assertAdminRole(["ADMIN"]);
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "") as Weekday;
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  try {
    const supabase = getSupabaseServerClient();
    await addDoctorAvailabilitySession(supabase, doctorId, dayOfWeek, startTime, endTime);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to add session." };
  }

  revalidatePath(`/admin/doctors/${doctorId}`);
  return {};
}

export async function removeAvailabilityAction(
  doctorId: string,
  sessionId: string
): Promise<void> {
  await assertAdminRole(["ADMIN"]);
  const supabase = getSupabaseServerClient();
  await removeDoctorAvailabilitySession(supabase, sessionId);
  revalidatePath(`/admin/doctors/${doctorId}`);
}

export async function addLeaveAction(
  doctorId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  await assertAdminRole(["ADMIN"]);
  const leaveDate = String(formData.get("leaveDate") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    const supabase = getSupabaseServerClient();
    await addDoctorLeave(supabase, doctorId, leaveDate, reason);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to add leave." };
  }

  revalidatePath(`/admin/doctors/${doctorId}`);
  return {};
}

export async function cancelLeaveAction(doctorId: string, leaveDate: string): Promise<void> {
  await assertAdminRole(["ADMIN"]);
  const supabase = getSupabaseServerClient();
  await deactivateDoctorLeave(supabase, doctorId, leaveDate);
  revalidatePath(`/admin/doctors/${doctorId}`);
}
