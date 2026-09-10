"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hashPassword, validateNewPassword } from "@/lib/auth/password";
import { requireAdminRole } from "@/lib/auth/authorize";
import type { AdminRole } from "@/lib/supabase/database.types";

/**
 * Admin User Management Actions
 *
 * Only users with ADMIN role can manage other admins.
 * Includes: list, create, update password, change role, deactivate.
 */

export interface AdminUserFormState {
  success?: boolean;
  error?: string;
  data?: any;
}

const MAX_ADMINS = 10; // Configurable limit

/**
 * Get count of active admins
 */
export async function getAdminCount(): Promise<number> {
  await requireAdminRole(["ADMIN"]);

  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase
    .from("admin_users")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  if (error) {
    throw new Error(`Failed to get admin count: ${error.message}`);
  }

  return count || 0;
}

/**
 * List all active admin users
 */
export async function listAdminUsers(): Promise<
  Array<{
    id: string;
    email: string;
    full_name: string;
    role: AdminRole;
    active: boolean;
    created_at: string;
  }>
> {
  await requireAdminRole(["ADMIN"]);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, email, full_name, role, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list admins: ${error.message}`);
  }

  return data || [];
}

/**
 * Create new admin user
 */
export async function createAdminUserAction(
  _prevState: AdminUserFormState,
  formData: FormData
): Promise<AdminUserFormState> {
  await requireAdminRole(["ADMIN"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const role = (String(formData.get("role") ?? "RECEPTIONIST") as AdminRole) || "RECEPTIONIST";

  // Validation
  if (!email) {
    return { error: "Email is required" };
  }

  if (!email.includes("@")) {
    return { error: "Invalid email address" };
  }

  const validationError = validateNewPassword(password, confirmPassword);
  if (validationError) {
    return { error: validationError };
  }

  if (!full_name) {
    return { error: "Full name is required" };
  }

  try {
    // Check admin limit
    const adminCount = await getAdminCount();
    if (adminCount >= MAX_ADMINS) {
      return {
        error: `Cannot create more than ${MAX_ADMINS} admin users. Current: ${adminCount}.`
      };
    }

    const supabase = getSupabaseServerClient();

    // Check if email already exists
    const { data: existing } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .single();

    if (existing) {
      return { error: "Email already in use" };
    }

    // Hash password
    const password_hash = await hashPassword(password);

    // Create admin user
    const { data, error } = await supabase
      .from("admin_users")
      .insert({
        email,
        full_name,
        password_hash,
        role,
        active: true
      })
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/admin/admin-users");
    return { success: true, data };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to create admin user"
    };
  }
}

/**
 * Reset admin password
 */
export async function resetAdminPasswordAction(
  adminId: string,
  _prevState: AdminUserFormState,
  formData: FormData
): Promise<AdminUserFormState> {
  await requireAdminRole(["ADMIN"]);

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const validationError = validateNewPassword(password, confirmPassword);
  if (validationError) {
    return { error: validationError };
  }

  try {
    const supabase = getSupabaseServerClient();

    // Hash password
    const password_hash = await hashPassword(password);

    // Update password
    const { error } = await supabase
      .from("admin_users")
      .update({ password_hash })
      .eq("id", adminId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/admin/admin-users");
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to reset password"
    };
  }
}

/**
 * Change admin role
 */
export async function changeAdminRoleAction(
  adminId: string,
  newRole: AdminRole
): Promise<AdminUserFormState> {
  await requireAdminRole(["ADMIN"]);

  if (!["ADMIN", "RECEPTIONIST"].includes(newRole)) {
    return { error: "Invalid role" };
  }

  try {
    const supabase = getSupabaseServerClient();

    const { error } = await supabase
      .from("admin_users")
      .update({ role: newRole })
      .eq("id", adminId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/admin/admin-users");
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to change role"
    };
  }
}

/**
 * Deactivate admin user (soft delete)
 */
export async function deactivateAdminAction(adminId: string): Promise<AdminUserFormState> {
  await requireAdminRole(["ADMIN"]);

  try {
    const supabase = getSupabaseServerClient();

    // Check if this is the last active admin
    const { count } = await supabase
      .from("admin_users")
      .select("*", { count: "exact", head: true })
      .eq("active", true);

    if (count === 1) {
      return { error: "Cannot deactivate the last admin user" };
    }

    const { error } = await supabase
      .from("admin_users")
      .update({ active: false })
      .eq("id", adminId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath("/admin/admin-users");
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to deactivate user"
    };
  }
}

/**
 * Get MAX_ADMINS limit (for UI display)
 */
export function getAdminLimit(): number {
  return MAX_ADMINS;
}
