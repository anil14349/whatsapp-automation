"use server";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { authenticateDoctor } from "@/lib/auth/doctorAuthenticate";
import { createDoctorSession } from "@/lib/auth/doctorSession";

export interface LoginFormState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = getSupabaseServerClient();
  const result = await authenticateDoctor(supabase, email, password);

  if (!result.success || !result.doctor) {
    return { error: result.message ?? "Invalid email or password." };
  }

  await createDoctorSession(result.doctor);
  redirect("/doctor");
}
