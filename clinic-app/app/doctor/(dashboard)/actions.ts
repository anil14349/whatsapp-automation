"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GoogleCalendar } from "@/lib/calendar/google";
import { cancelAppointment, markAppointmentStatus } from "@/lib/appointments";
import { clearDoctorSession } from "@/lib/auth/doctorSession";
import { assertDoctorSession } from "@/lib/auth/doctorAuthorize";

export async function logoutAction(): Promise<void> {
  await clearDoctorSession();
  redirect("/doctor/login");
}

/**
 * Cancellation goes through the same cancelAppointment() used by the
 * admin UI and the WhatsApp patient/doctor flows — same Calendar
 * cleanup, same status-transition rules — rather than a separate ad-hoc
 * doctor-portal-only code path that could drift from those rules over
 * time. `authorizedDoctorId` always comes from the caller's own session
 * (never a client-supplied doctorId), so a doctor can only ever act on
 * their own appointments.
 */
export async function doctorCancelAppointmentAction(appointmentId: string): Promise<void> {
  const session = await assertDoctorSession();
  const supabase = getSupabaseServerClient();
  const calendar = new GoogleCalendar();

  const result = await cancelAppointment(supabase, calendar, appointmentId, {
    authorizedDoctorId: session.doctorId
  });

  if (!result.success) {
    throw new Error(result.message);
  }

  revalidatePath("/doctor");
}

export async function doctorMarkAppointmentStatusAction(
  appointmentId: string,
  status: "Completed" | "No-Show"
): Promise<void> {
  const session = await assertDoctorSession();
  const supabase = getSupabaseServerClient();

  const result = await markAppointmentStatus(supabase, appointmentId, session.doctorId, status);

  if (!result.success) {
    throw new Error(result.message);
  }

  revalidatePath("/doctor");
}
