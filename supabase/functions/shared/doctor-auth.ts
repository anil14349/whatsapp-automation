import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePin, PIN_CONFIG } from "./config.ts";
import { debug } from "./logger.ts";

/**
 * Doctor Portal Authentication
 * Manages PIN-based login with rate limiting and attempt tracking
 */

interface AuthAttempt {
    phone: string;
    clinic_id: string;
    attempt_count: number;
    last_attempt_at: Date;
    locked_until?: Date;
    is_locked: boolean;
}

/**
 * Execution-scoped cache for auth attempts
 * Prevents repeated database queries for failed attempts
 */
let __authAttemptsCache: { [key: string]: AuthAttempt } = {};

/**
 * Get cache key for auth attempt tracking
 */
function getAuthCacheKey(phone: string, clinicId: string): string {
    return `auth_${phone}_${clinicId}`;
}

/**
 * Check if doctor account is currently locked due to failed attempts
 */
export function isAccountLocked(phone: string, clinicId: string): boolean {
    const cacheKey = getAuthCacheKey(phone, clinicId);
    const cachedAttempt = __authAttemptsCache[cacheKey];

    if (cachedAttempt && cachedAttempt.locked_until) {
        const now = new Date();
        if (now < cachedAttempt.locked_until) {
            return true; // Still locked
        }
        // Lockout expired, clear it
        cachedAttempt.is_locked = false;
        cachedAttempt.locked_until = undefined;
        cachedAttempt.attempt_count = 0;
    }

    return false;
}

/**
 * Get remaining attempts before lockout
 * Returns -1 if account is locked
 */
export function getRemainingAttempts(phone: string, clinicId: string): number {
    if (isAccountLocked(phone, clinicId)) {
        return -1; // Locked
    }

    const cacheKey = getAuthCacheKey(phone, clinicId);
    const cachedAttempt = __authAttemptsCache[cacheKey];
    const attempts = cachedAttempt?.attempt_count || 0;

    return Math.max(0, PIN_CONFIG.MAX_ATTEMPTS - attempts);
}

/**
 * Get lockout minutes remaining
 * Returns 0 if not locked
 */
export function getLockoutMinutesRemaining(phone: string, clinicId: string): number {
    const cacheKey = getAuthCacheKey(phone, clinicId);
    const cachedAttempt = __authAttemptsCache[cacheKey];

    if (!cachedAttempt?.locked_until) {
        return 0;
    }

    const now = new Date();
    const diffMs = cachedAttempt.locked_until.getTime() - now.getTime();

    if (diffMs <= 0) {
        return 0;
    }

    return Math.ceil(diffMs / (1000 * 60));
}

/**
 * Verify doctor PIN
 * Returns: { success: boolean, error?: string }
 *
 * Success scenarios:
 * - Correct PIN → { success: true }
 *
 * Failure scenarios:
 * - Account locked → { success: false, error: "account_locked" }
 * - Wrong PIN → { success: false, error: "invalid_pin" }
 * - Max attempts reached → { success: false, error: "account_locked" }
 */
export async function verifyDoctorPin(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string,
    providedPin: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Check if account is locked
        if (isAccountLocked(phone, clinicId)) {
            const minutesRemaining = getLockoutMinutesRemaining(phone, clinicId);
            debug("doctorAuth", "Account locked due to failed attempts", {
                phone,
                minutesRemaining
            });

            return {
                success: false,
                error: `account_locked_${minutesRemaining}`
            };
        }

        // Validate PIN format (4-8 digits)
        const normalizedPin = String(providedPin || "").trim();
        if (
            normalizedPin.length < PIN_CONFIG.PIN_LENGTH_MIN ||
            normalizedPin.length > PIN_CONFIG.PIN_LENGTH_MAX ||
            !/^\d+$/.test(normalizedPin)
        ) {
            // Record failed attempt
            await recordFailedAttempt(phone, clinicId);
            return {
                success: false,
                error: "invalid_pin"
            };
        }

        // Validate PIN using constant-time comparison
        const isValid = validatePin(providedPin, clinicId);

        if (!isValid) {
            // Record failed attempt
            await recordFailedAttempt(phone, clinicId);

            const remainingAttempts = getRemainingAttempts(phone, clinicId);

            if (remainingAttempts === 0) {
                debug("doctorAuth", "Account locked - max attempts reached", {
                    phone
                });

                return {
                    success: false,
                    error: `account_locked_${PIN_CONFIG.LOCKOUT_MINUTES}`
                };
            }

            return {
                success: false,
                error: "invalid_pin"
            };
        }

        // PIN is valid - clear any previous failed attempts
        await clearFailedAttempts(phone, clinicId);

        debug("doctorAuth", "Doctor authentication successful", {
            phone
        });

        return { success: true };
    } catch (error) {
        debug("doctorAuth", "Error verifying PIN", {
            error: error instanceof Error ? error.message : String(error)
        });

        return {
            success: false,
            error: "auth_error"
        };
    }
}

/**
 * Record a failed authentication attempt
 * Increments attempt counter and locks account if max attempts reached
 */
async function recordFailedAttempt(phone: string, clinicId: string): Promise<void> {
    const cacheKey = getAuthCacheKey(phone, clinicId);
    let attempt = __authAttemptsCache[cacheKey];

    if (!attempt) {
        attempt = {
            phone,
            clinic_id: clinicId,
            attempt_count: 0,
            last_attempt_at: new Date(),
            is_locked: false
        };
    }

    attempt.attempt_count += 1;
    attempt.last_attempt_at = new Date();

    // Lock account if max attempts reached
    if (attempt.attempt_count >= PIN_CONFIG.MAX_ATTEMPTS) {
        attempt.is_locked = true;
        attempt.locked_until = new Date(
            Date.now() + PIN_CONFIG.LOCKOUT_MINUTES * 60 * 1000
        );

        debug("doctorAuth", "Account locked due to failed attempts", {
            phone,
            attempts: attempt.attempt_count
        });
    }

    __authAttemptsCache[cacheKey] = attempt;
}

/**
 * Clear failed authentication attempts (after successful login)
 */
async function clearFailedAttempts(phone: string, clinicId: string): Promise<void> {
    const cacheKey = getAuthCacheKey(phone, clinicId);
    delete __authAttemptsCache[cacheKey];
}

/**
 * Clear auth cache (for testing)
 */
export function clearAuthCache(): void {
    __authAttemptsCache = {};
}

/**
 * Format auth error message for user display
 */
export function formatAuthErrorMessage(error: string, language: string = "EN"): string {
    if (error === "invalid_pin") {
        return language === "EN"
            ? "❌ Incorrect PIN. Please try again."
            : "❌ गलत PIN। कृपया दोबारा कोशिश करें।";
    }

    if (error.startsWith("account_locked_")) {
        const minutesRemaining = parseInt(error.substring("account_locked_".length), 10);
        return language === "EN"
            ? `⏳ Account locked. Too many failed attempts.\n\nPlease try again in ${minutesRemaining} minutes.`
            : `⏳ खाता लॉक है। बहुत सारे असफल प्रयास।\n\n${minutesRemaining} मिनट में दोबारा कोशिश करें।`;
    }

    if (error === "auth_error") {
        return language === "EN"
            ? "❌ Authentication error. Please try again later."
            : "❌ प्रमाणीकरण त्रुटि। कृपया बाद में दोबारा कोशिश करें।";
    }

    return language === "EN"
        ? "❌ Authentication failed. Please try again."
        : "❌ प्रमाणीकरण विफल। कृपया दोबारा कोशिश करें।";
}

/**
 * Get PIN entry prompt with attempt counter
 */
export function getPinEntryPrompt(phone: string, clinicId: string, language: string = "EN"): string {
    const remainingAttempts = getRemainingAttempts(phone, clinicId);

    if (remainingAttempts === -1) {
        const minutesRemaining = getLockoutMinutesRemaining(phone, clinicId);
        return language === "EN"
            ? `⏳ Account locked. Please try again in ${minutesRemaining} minutes.`
            : `⏳ खाता लॉक है। ${minutesRemaining} मिनट में दोबारा कोशिश करें।`;
    }

    const prompt =
        language === "EN"
            ? `🔐 Enter your 4-6 digit PIN:\n\n(${remainingAttempts} attempts remaining)`
            : `🔐 अपना 4-6 अंकीय PIN दर्ज करें:\n\n(${remainingAttempts} प्रयास शेष)`;

    return prompt;
}
