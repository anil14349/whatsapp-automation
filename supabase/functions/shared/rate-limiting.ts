/**
 * Rate Limiting for Login Attempts
 * 
 * Prevents brute force attacks by tracking failed login attempts
 * per user/clinic combination and implementing temporary lockouts
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

/**
 * Admins were missing from this, and so were never locked out: the column is
 * constrained to these values, so a failed admin attempt violated the check
 * and was discarded.
 */
export type LoginUserType = "doctor" | "receptionist" | "admin";

export interface RateLimitConfig {
  maxAttempts: number;        // Max failed attempts before lockout
  lockoutDurationMinutes: number;  // How long to lock account
  attemptWindowMinutes: number;    // Time window for counting attempts
}

// Default rate limit configuration
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 3,              // 3 failed attempts
  lockoutDurationMinutes: 15,  // 15 minute lockout
  attemptWindowMinutes: 5      // 5 minute window for counting
};

/**
 * Check if user is rate limited (locked out)
 * 
 * @param supabase - Supabase client
 * @param userId - User ID (doctor or receptionist)
 * @param userType - Type of user ('doctor' or 'receptionist')
 * @returns Promise<boolean> - true if rate limited, false if allowed
 */
export async function isRateLimited(
  supabase: SupabaseClient,
  userId: string,
  userType: LoginUserType
): Promise<boolean> {
  try {
    const now = new Date();
    const lockoutExpiry = new Date(now.getTime() - DEFAULT_RATE_LIMIT.lockoutDurationMinutes * 60000);

    const { data, error } = await supabase
      .from("login_rate_limits")
      .select("*")
      .eq("user_id", userId)
      .eq("user_type", userType)
      .single();

    if (error || !data) {
      // No rate limit record, user is not locked out
      return false;
    }

    // Check if lockout has expired
    const lastFailedAt = new Date(data.last_failed_at);
    if (lastFailedAt < lockoutExpiry) {
      // Lockout expired, reset the record
      await supabase
        .from("login_rate_limits")
        .update({
          failed_attempts: 0,
          last_failed_at: now.toISOString(),
          locked_until: null
        })
        .eq("user_id", userId)
        .eq("user_type", userType);

      return false;
    }

    // Check if currently locked out
    if (data.locked_until) {
      const lockedUntil = new Date(data.locked_until);
      if (now < lockedUntil) {
        return true;  // Still locked out
      }
    }

    return false;
  } catch (error) {
    debug("rateLimiting", "Error checking rate limit", {
      userId,
      userType,
      error: error instanceof Error ? error.message : String(error)
    });
    // Fail secure - lock out on error
    return true;
  }
}

/**
 * Record a failed login attempt
 * 
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param userType - Type of user
 * @param clinicId - Clinic ID
 * @returns Promise<boolean> - true if locked after this attempt, false otherwise
 */
export async function recordFailedAttempt(
  supabase: SupabaseClient,
  userId: string,
  userType: LoginUserType,
  /** Null for a platform admin, who belongs to no clinic. */
  clinicId: string | null
): Promise<boolean> {
  try {
    const now = new Date();

    // Read, add one, write back let two failures arriving together both read
    // the same count and both write the same number, so the threshold was
    // never reached. These are public login endpoints, so an attacker sends
    // them together deliberately. Each write is conditioned on the count that
    // was read, and whoever loses goes round again.
    for (let round = 0; round < 5; round++) {
      const { data, error } = await supabase
        .from("login_rate_limits")
        .select("*")
        .eq("user_id", userId)
        .eq("user_type", userType)
        .maybeSingle();

      if (error || !data) {
        const { error: insertError } = await supabase
          .from("login_rate_limits")
          .insert({
            user_id: userId,
            user_type: userType,
            clinic_id: clinicId,
            failed_attempts: 1,
            last_failed_at: now.toISOString(),
            locked_until: null
          });

        // login_rate_limits_user_unique refuses the loser of a race to create
        // the row, which then goes round and updates it instead.
        if (!insertError) {
          return 1 >= DEFAULT_RATE_LIMIT.maxAttempts;
        }

        continue;
      }

      const lastFailedAt = new Date(data.last_failed_at);
      const attemptWindowExpiry = new Date(
        now.getTime() - DEFAULT_RATE_LIMIT.attemptWindowMinutes * 60000
      );

      const stored = data.failed_attempts ?? 0;
      const failedAttempts = lastFailedAt > attemptWindowExpiry ? stored + 1 : 1;
      const shouldLock = failedAttempts >= DEFAULT_RATE_LIMIT.maxAttempts;

      const { data: changed } = await supabase
        .from("login_rate_limits")
        .update({
          failed_attempts: failedAttempts,
          last_failed_at: now.toISOString(),
          locked_until: shouldLock
            ? new Date(now.getTime() + DEFAULT_RATE_LIMIT.lockoutDurationMinutes * 60000).toISOString()
            : null
        })
        .eq("user_id", userId)
        .eq("user_type", userType)
        .eq("failed_attempts", stored)
        .select("user_id");

      if (changed && changed.length > 0) {
        if (shouldLock) {
          debug("rateLimiting", "User locked out after failed attempts", {
            userId,
            userType,
            failedAttempts,
            lockoutDuration: DEFAULT_RATE_LIMIT.lockoutDurationMinutes
          });
        }

        return shouldLock;
      }
    }

    // Contention this persistent is not normal; treat it as an attack.
    return true;
  } catch (error) {
    debug("rateLimiting", "Error recording failed attempt", {
      userId,
      userType,
      error: error instanceof Error ? error.message : String(error)
    });
    // Fail secure - still attempt to lock
    return true;
  }
}

/**
 * Clear failed attempts on successful login
 * 
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param userType - Type of user
 */
export async function clearFailedAttempts(
  supabase: SupabaseClient,
  userId: string,
  userType: LoginUserType
): Promise<void> {
  try {
    await supabase
      .from("login_rate_limits")
      .update({
        failed_attempts: 0,
        last_failed_at: new Date().toISOString(),
        locked_until: null
      })
      .eq("user_id", userId)
      .eq("user_type", userType);

    debug("rateLimiting", "Failed attempts cleared", { userId, userType });
  } catch (error) {
    debug("rateLimiting", "Error clearing failed attempts", {
      userId,
      userType,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Get remaining lockout time in minutes
 * 
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param userType - Type of user
 * @returns Promise<number> - Minutes remaining in lockout, 0 if not locked
 */
export async function getRemainingLockoutTime(
  supabase: SupabaseClient,
  userId: string,
  userType: LoginUserType
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("login_rate_limits")
      .select("locked_until")
      .eq("user_id", userId)
      .eq("user_type", userType)
      .single();

    if (error || !data || !data.locked_until) {
      return 0;
    }

    const lockedUntil = new Date(data.locked_until);
    const now = new Date();
    const remainingMs = lockedUntil.getTime() - now.getTime();

    if (remainingMs <= 0) {
      return 0;
    }

    return Math.ceil(remainingMs / 60000);  // Convert to minutes
  } catch (error) {
    debug("rateLimiting", "Error getting lockout time", {
      userId,
      userType,
      error: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }
}
