"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GoogleCalendar } from "@/lib/calendar/google";
import { cancelAppointment } from "@/lib/appointments";

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
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("doctor_id", doctorId) // same fail-closed ownership pattern as cancelAppointment
    .in("status", ["Confirmed"]);

  if (error) {
    throw new Error(`Failed to update appointment status: ${error.message}`);
  }

  revalidatePath("/admin/appointments");
}
