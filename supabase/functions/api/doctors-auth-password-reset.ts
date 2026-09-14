/**
 * Doctor Password Reset API
 * 
 * POST /api/doctors/auth/password-reset/request
 * Request a password reset token via email
 * 
 * POST /api/doctors/auth/password-reset/confirm
 * Confirm password reset with token and new PIN
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { badRequestResponse, errorResponse, successResponse, withAuth } from "../shared/auth-middleware.ts";
import { debug } from "../shared/logger.ts";
import { hashPassword, validatePinStrength } from "../shared/bcrypt-password.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";

interface PasswordResetRequest {
  email: string;
  clinicId: string;
}

interface PasswordResetConfirm {
  token: string;
  newPin: string;
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
export async function handleDoctorPasswordResetRequest(req: Request): Promise<Response> {
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

    // Find doctor by email and clinic
    const { data: doctor, error: docError } = await supabase
      .from("doctors")
      .select("id, name, email")
      .eq("email", body.email)
      .eq("clinic_id", body.clinicId)
      .single();

    if (docError || !doctor) {
      // Don't reveal if email exists (security)
      debug("doctorPasswordReset", "Doctor not found", { email: body.email, clinicId: body.clinicId });
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
        user_id: doctor.id,
        user_type: "doctor",
        token: resetToken,
        expires_at: expiresAt.toISOString(),
        used: false
      });

    if (tokenError) {
      debug("doctorPasswordReset", "Error storing reset token", { error: tokenError.message });
      return errorResponse("Failed to initiate password reset", 500);
    }

    // TODO: Send reset email with token
    // For now, just log it
    debug("doctorPasswordReset", "Reset token generated", {
      doctorId: doctor.id,
      token: resetToken.substring(0, 8) + "..." // Log only first 8 chars
    });

    return successResponse({ message: "If email exists, reset link will be sent" });
  } catch (error) {
    debug("doctorPasswordReset", "Error processing request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse("Internal server error", 500);
  }
}

/**
 * Confirm password reset
 */
export async function handleDoctorPasswordResetConfirm(req: Request): Promise<Response> {
  try {
    const body = await req.json() as PasswordResetConfirm;

    if (!body.token || !body.newPin) {
      return badRequestResponse("Missing required fields: token, newPin");
    }

    // Validate PIN strength
    const pinValidation = validatePinStrength(body.newPin);
    if (!pinValidation.valid) {
      return badRequestResponse(
        `Invalid PIN: ${pinValidation.errors.join(", ")}`
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
      .eq("user_type", "doctor")
      .eq("used", false)
      .single();

    if (tokenError || !resetRecord) {
      debug("doctorPasswordReset", "Invalid reset token");
      return badRequestResponse("Invalid or expired reset token");
    }

    // Check if token expired
    const expiresAt = new Date(resetRecord.expires_at);
    if (expiresAt < new Date()) {
      debug("doctorPasswordReset", "Reset token expired");
      return badRequestResponse("Reset token has expired");
    }

    // Hash new PIN
    const hashedPin = await hashPassword(body.newPin);

    // Update doctor PIN
    const { error: updateError } = await supabase
      .from("doctors")
      .update({ pin_hash: hashedPin })
      .eq("id", resetRecord.user_id);

    if (updateError) {
      debug("doctorPasswordReset", "Error updating PIN", { error: updateError.message });
      return errorResponse("Failed to update PIN", 500);
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
      .eq("user_type", "doctor");

    debug("doctorPasswordReset", "PIN reset successfully", { doctorId: resetRecord.user_id });

    return successResponse({ message: "PIN reset successfully. Please login with your new PIN." });
  } catch (error) {
    debug("doctorPasswordReset", "Error processing reset", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse("Internal server error", 500);
  }
}

/**
 * Change password (for authenticated users)
 */
export async function handleDoctorPasswordChange(req: Request): Promise<Response> {
  return withAuth(req, "DOCTOR", async (user: TokenPayload) => {
    try {
      const body = await req.json() as {
        currentPin: string;
        newPin: string;
      };

      if (!body.currentPin || !body.newPin) {
        return badRequestResponse("Missing required fields: currentPin, newPin");
      }

      if (body.currentPin === body.newPin) {
        return badRequestResponse("New PIN must be different from current PIN");
      }

      // Validate new PIN strength
      const pinValidation = validatePinStrength(body.newPin);
      if (!pinValidation.valid) {
        return badRequestResponse(
          `Invalid PIN: ${pinValidation.errors.join(", ")}`
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !supabaseKey) {
        return errorResponse("Server configuration error", 500);
      }

      const supabase = new SupabaseClient(supabaseUrl, supabaseKey);

      // Verify current PIN
      const { data: doctor, error: docError } = await supabase
        .from("doctors")
        .select("pin_hash")
        .eq("id", user.userId)
        .single();

      if (docError || !doctor) {
        return errorResponse("Doctor not found", 404);
      }

      // Verify current PIN
      const { verifyPassword } = await import("../shared/bcrypt-password.ts");
      const isValid = await verifyPassword(body.currentPin, doctor.pin_hash);

      if (!isValid) {
        debug("doctorPasswordChange", "Invalid current PIN", { doctorId: user.userId });
        return badRequestResponse("Current PIN is incorrect");
      }

      // Hash new PIN
      const hashedPin = await hashPassword(body.newPin);

      // Update PIN
      const { error: updateError } = await supabase
        .from("doctors")
        .update({ pin_hash: hashedPin })
        .eq("id", user.userId);

      if (updateError) {
        debug("doctorPasswordChange", "Error updating PIN", { error: updateError.message });
        return errorResponse("Failed to update PIN", 500);
      }

      debug("doctorPasswordChange", "PIN changed successfully", { doctorId: user.userId });

      return successResponse({ message: "PIN changed successfully" });
    } catch (error) {
      debug("doctorPasswordChange", "Error processing change", {
        error: error instanceof Error ? error.message : String(error)
      });
      return errorResponse("Internal server error", 500);
    }
  });
}
