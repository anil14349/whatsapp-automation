/**
 * Receptionist Password Reset API
 * 
 * POST /api/receptionists/auth/password-reset/request
 * Request a password reset token via email
 * 
 * POST /api/receptionists/auth/password-reset/confirm
 * Confirm password reset with token and new password
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { badRequestResponse, errorResponse, successResponse, withAuth } from "../shared/auth-middleware.ts";
import { debug } from "../shared/logger.ts";
import { hashPassword, validatePasswordStrength } from "../shared/bcrypt-password.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";

interface PasswordResetRequest {
  email: string;
  clinicId: string;
}

interface PasswordResetConfirm {
  token: string;
  newPassword: string;
}

/**
 * Generate a secure reset token (32 character random string)
 */
function generateResetToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Request password reset
 */
export async function handleReceptionistPasswordResetRequest(req: Request): Promise<Response> {
  try {
    const body = await req.json() as PasswordResetRequest;

    if (!body.email || !body.clinicId) {
      return badRequestResponse("Missing required fields: email, clinicId");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = new SupabaseClient(supabaseUrl, supabaseKey);

    // Find receptionist by email and clinic
    const { data: receptionist, error: recError } = await supabase
      .from("receptionists")
      .select("id, name, email")
      .eq("email", body.email)
      .eq("clinic_id", body.clinicId)
      .eq("status", "ACTIVE")
      .single();

    if (recError || !receptionist) {
      // Don't reveal if email exists (security)
      debug("receptionistPasswordReset", "Receptionist not found", { email: body.email, clinicId: body.clinicId });
      return successResponse({ message: "If email exists, reset link will be sent" });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = generateResetToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Store reset token
    const { error: tokenError } = await supabase
      .from("password_reset_tokens")
      .insert({
        user_id: receptionist.id,
        user_type: "receptionist",
        token: resetToken,
        expires_at: expiresAt.toISOString(),
        used: false
      });

    if (tokenError) {
      debug("receptionistPasswordReset", "Error storing reset token", { error: tokenError.message });
      return errorResponse("Failed to initiate password reset", 500);
    }

    // TODO: Send reset email with token
    // For now, just log it
    debug("receptionistPasswordReset", "Reset token generated", {
      receptionistId: receptionist.id,
      token: resetToken.substring(0, 8) + "..." // Log only first 8 chars
    });

    return successResponse({ message: "If email exists, reset link will be sent" });
  } catch (error) {
    debug("receptionistPasswordReset", "Error processing request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse("Internal server error", 500);
  }
}

/**
 * Confirm password reset
 */
export async function handleReceptionistPasswordResetConfirm(req: Request): Promise<Response> {
  try {
    const body = await req.json() as PasswordResetConfirm;

    if (!body.token || !body.newPassword) {
      return badRequestResponse("Missing required fields: token, newPassword");
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(body.newPassword);
    if (!passwordValidation.valid) {
      return badRequestResponse(
        `Invalid password: ${passwordValidation.errors.join(", ")}`
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = new SupabaseClient(supabaseUrl, supabaseKey);

    // Verify reset token
    const { data: resetRecord, error: tokenError } = await supabase
      .from("password_reset_tokens")
      .select("*")
      .eq("token", body.token)
      .eq("user_type", "receptionist")
      .eq("used", false)
      .single();

    if (tokenError || !resetRecord) {
      debug("receptionistPasswordReset", "Invalid reset token");
      return badRequestResponse("Invalid or expired reset token");
    }

    // Check if token expired
    const expiresAt = new Date(resetRecord.expires_at);
    if (expiresAt < new Date()) {
      debug("receptionistPasswordReset", "Reset token expired");
      return badRequestResponse("Reset token has expired");
    }

    // Hash new password
    const hashedPassword = await hashPassword(body.newPassword);

    // Update receptionist password
    const { error: updateError } = await supabase
      .from("receptionists")
      .update({ password_hash: hashedPassword })
      .eq("id", resetRecord.user_id);

    if (updateError) {
      debug("receptionistPasswordReset", "Error updating password", { error: updateError.message });
      return errorResponse("Failed to update password", 500);
    }

    // Mark token as used
    await supabase
      .from("password_reset_tokens")
      .update({ used: true })
      .eq("id", resetRecord.id);

    // Clear failed login attempts
    await supabase
      .from("login_rate_limits")
      .update({
        failed_attempts: 0,
        locked_until: null
      })
      .eq("user_id", resetRecord.user_id)
      .eq("user_type", "receptionist");

    debug("receptionistPasswordReset", "Password reset successfully", { receptionistId: resetRecord.user_id });

    return successResponse({ message: "Password reset successfully. Please login with your new password." });
  } catch (error) {
    debug("receptionistPasswordReset", "Error processing reset", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse("Internal server error", 500);
  }
}

/**
 * Change password (for authenticated users)
 */
export async function handleReceptionistPasswordChange(req: Request): Promise<Response> {
  return withAuth(req, "RECEPTIONIST", async (user: TokenPayload) => {
    try {
      const body = await req.json() as {
        currentPassword: string;
        newPassword: string;
      };

      if (!body.currentPassword || !body.newPassword) {
        return badRequestResponse("Missing required fields: currentPassword, newPassword");
      }

      if (body.currentPassword === body.newPassword) {
        return badRequestResponse("New password must be different from current password");
      }

      // Validate new password strength
      const passwordValidation = validatePasswordStrength(body.newPassword);
      if (!passwordValidation.valid) {
        return badRequestResponse(
          `Invalid password: ${passwordValidation.errors.join(", ")}`
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !supabaseKey) {
        return errorResponse("Server configuration error", 500);
      }

      const supabase = new SupabaseClient(supabaseUrl, supabaseKey);

      // Verify current password
      const { data: receptionist, error: recError } = await supabase
        .from("receptionists")
        .select("password_hash")
        .eq("id", user.userId)
        .single();

      if (recError || !receptionist) {
        return errorResponse("Receptionist not found", 404);
      }

      // Verify current password
      const { verifyPassword } = await import("../shared/bcrypt-password.ts");
      const isValid = await verifyPassword(body.currentPassword, receptionist.password_hash);

      if (!isValid) {
        debug("receptionistPasswordChange", "Invalid current password", { receptionistId: user.userId });
        return badRequestResponse("Current password is incorrect");
      }

      // Hash new password
      const hashedPassword = await hashPassword(body.newPassword);

      // Update password
      const { error: updateError } = await supabase
        .from("receptionists")
        .update({ password_hash: hashedPassword })
        .eq("id", user.userId);

      if (updateError) {
        debug("receptionistPasswordChange", "Error updating password", { error: updateError.message });
        return errorResponse("Failed to update password", 500);
      }

      debug("receptionistPasswordChange", "Password changed successfully", { receptionistId: user.userId });

      return successResponse({ message: "Password changed successfully" });
    } catch (error) {
      debug("receptionistPasswordChange", "Error processing change", {
        error: error instanceof Error ? error.message : String(error)
      });
      return errorResponse("Internal server error", 500);
    }
  });
}
