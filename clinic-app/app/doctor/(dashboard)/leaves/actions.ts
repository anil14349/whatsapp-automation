"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { addDoctorLeave, deactivateDoctorLeave } from "@/lib/doctors";
import { assertDoctorSession } from "@/lib/auth/doctorAuthorize";

export interface FormState {
  error?: string;
}

export async function addLeaveAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await assertDoctorSession();
  const leaveDate = String(formData.get("leaveDate") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    const supabase = getSupabaseServerClient();
    await addDoctorLeave(supabase, session.doctorId, leaveDate, reason);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to add leave." };
  }

  revalidatePath("/doctor/leaves");
  return {};
}

export async function cancelLeaveAction(leaveDate: string): Promise<void> {
  const session = await assertDoctorSession();
  const supabase = getSupabaseServerClient();
  await deactivateDoctorLeave(supabase, session.doctorId, leaveDate);
  revalidatePath("/doctor/leaves");
}
