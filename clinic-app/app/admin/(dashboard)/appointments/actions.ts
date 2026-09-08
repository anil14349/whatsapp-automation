"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GoogleCalendar } from "@/lib/calendar/google";
import { cancelAppointment, markAppointmentStatus } from "@/lib/appointments";
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

  await cancelAppointment(supabase, calendar, appointmentId, {
    authorizedDoctorId: doctorId
  });

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
