"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { addDoctorAvailabilitySession, removeDoctorAvailabilitySession } from "@/lib/doctors";
import type { Weekday } from "@/lib/supabase/database.types";
import { assertDoctorSession } from "@/lib/auth/doctorAuthorize";

export interface FormState {
  error?: string;
}

export async function addAvailabilityAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await assertDoctorSession();
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "") as Weekday;
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  try {
    const supabase = getSupabaseServerClient();
    await addDoctorAvailabilitySession(supabase, session.doctorId, dayOfWeek, startTime, endTime);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to add session." };
  }

  revalidatePath("/doctor/availability");
  return {};
}

export async function removeAvailabilityAction(sessionId: string): Promise<void> {
  const session = await assertDoctorSession();
  const supabase = getSupabaseServerClient();

  // removeDoctorAvailabilitySession(supabase, sessionId) has NO doctorId
  // ownership check inside it (it just deletes by row id) — it's shared
  // with the admin UI, which is allowed to touch any doctor's rows by
  // design. The doctor portal is not: a logged-in doctor must only ever
  // be able to delete their OWN availability rows, so we fetch the row
  // first and verify ownership here, before calling the shared function,
  // rather than trusting a client-supplied sessionId to belong to the
  // caller. Fails closed: no row, a lookup error, or a mismatched
  // doctor_id all result in nothing being deleted.
  const { data: row, error } = await supabase
    .from("doctor_availability")
    .select("doctor_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up availability session: ${error.message}`);
  }

  if (!row || row.doctor_id !== session.doctorId) {
    throw new Error("Availability session not found.");
  }

  await removeDoctorAvailabilitySession(supabase, sessionId);
  revalidatePath("/doctor/availability");
}
