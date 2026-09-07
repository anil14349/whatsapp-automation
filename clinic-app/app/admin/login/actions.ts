"use server";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { authenticateAdmin } from "@/lib/auth/authenticate";
import { createAdminSession } from "@/lib/auth/session";

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
  const result = await authenticateAdmin(supabase, email, password);

  if (!result.success || !result.user) {
    return { error: result.message ?? "Invalid email or password." };
  }

  await createAdminSession(result.user);
  redirect("/admin");
}
