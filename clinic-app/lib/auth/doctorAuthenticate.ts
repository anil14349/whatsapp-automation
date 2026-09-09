import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { verifyPassword } from "./password";

export interface DoctorAuthenticateResult {
  success: boolean;
  message?: string;
  doctor?: { id: string; email: string; name: string };
}

export async function authenticateDoctor(
  supabase: SupabaseClient<Database>,
  email: string,
  password: string
): Promise<DoctorAuthenticateResult> {
  const normalizedEmail = email.trim().toLowerCase();

  const { data: doctor, error } = await supabase
    .from("doctors")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up doctor: ${error.message}`);
  }

  // Deliberately identical error message whether the email doesn't exist,
  // has no password set, or the password is wrong — don't let a login
  // form reveal which emails are registered doctor accounts.
  const invalidCredentials: DoctorAuthenticateResult = {
    success: false,
    message: "Invalid email or password."
  };

  if (!doctor || !doctor.active || !doctor.password_hash) {
    return invalidCredentials;
  }

  const passwordMatches = await verifyPassword(password, doctor.password_hash);

  if (!passwordMatches) {
    return invalidCredentials;
  }

  return {
    success: true,
    doctor: { id: doctor.id, email: doctor.email ?? normalizedEmail, name: doctor.name }
  };
}
