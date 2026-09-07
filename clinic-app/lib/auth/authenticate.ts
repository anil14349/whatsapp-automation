import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { verifyPassword } from "./password";

export interface AuthenticateResult {
  success: boolean;
  message?: string;
  user?: { id: string; email: string; role: "ADMIN" | "RECEPTIONIST"; fullName: string };
}

export async function authenticateAdmin(
  supabase: SupabaseClient<Database>,
  email: string,
  password: string
): Promise<AuthenticateResult> {
  const normalizedEmail = email.trim().toLowerCase();

  const { data: user, error } = await supabase
    .from("admin_users")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up admin user: ${error.message}`);
  }

  // Deliberately identical error message whether the email doesn't exist
  // or the password is wrong — don't let a login form reveal which
  // emails are registered admin accounts.
  const invalidCredentials: AuthenticateResult = {
    success: false,
    message: "Invalid email or password."
  };

  if (!user || !user.active) {
    return invalidCredentials;
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);

  if (!passwordMatches) {
    return invalidCredentials;
  }

  return {
    success: true,
    user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name }
  };
}
