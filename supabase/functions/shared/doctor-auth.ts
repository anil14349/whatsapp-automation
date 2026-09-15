import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePin, PIN_CONFIG } from "./config.ts";
import { verifyPassword } from "./bcrypt-password.ts";
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
 * Per-request cache only.
 *
 * Attempts live in login_rate_limits because edge isolates are recycled
 * between messages; an in-memory counter reset itself and the lockout never
 * actually triggered.
 */
let __authAttemptsCache: { [key: string]: AuthAttempt } = {};

/**
 * Get cache key for auth attempt tracking
 */
function getAuthCacheKey(phone: string, clinicId: string): string {
    return `auth_${phone}_${clinicId}`;
}

async function findDoctorId(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<string | null> {
    const { data } = await supabase
        .from("doctors")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("phone", phone)
        .maybeSingle();

    return data?.id ?? null;
}

/**
 * Read the stored attempt state, caching it for the rest of this request.
 */
async function loadAttempt(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<AuthAttempt> {
    const cacheKey = getAuthCacheKey(phone, clinicId);
    const cached = __authAttemptsCache[cacheKey];

    if (cached) {
        return cached;
    }

    const blank: AuthAttempt = {
        phone,
        clinic_id: clinicId,
        attempt_count: 0,
        last_attempt_at: new Date(),
        is_locked: false
    };

    try {
        const doctorId = await findDoctorId(supabase, phone, clinicId);

        if (doctorId) {
            const { data } = await supabase
                .from("login_rate_limits")
                .select("failed_attempts, locked_until")
                .eq("user_id", doctorId)
                .eq("user_type", "doctor")
                .maybeSingle();

            if (data) {
                blank.attempt_count = data.failed_attempts ?? 0;

                if (data.locked_until) {
                    const until = new Date(data.locked_until);

                    if (until > new Date()) {
                        blank.locked_until = until;
                        blank.is_locked = true;
                    } else {
                        // Lockout expired; the counter starts again.
                        blank.attempt_count = 0;
                    }
                }
            }
        }
    } catch (error) {
        debug("doctorAuth", "Could not read attempt state", {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    __authAttemptsCache[cacheKey] = blank;
    return blank;
}

/**
 * Check if doctor account is currently locked due to failed attempts
 */
export async function isAccountLocked(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<boolean> {
    const attempt = await loadAttempt(supabase, phone, clinicId);

    if (attempt.locked_until && attempt.locked_until > new Date()) {
        return true;
    }

    attempt.is_locked = false;
    attempt.locked_until = undefined;
    return false;
}

/**
 * Get remaining attempts before lockout
 * Returns -1 if account is locked
 */
export async function getRemainingAttempts(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<number> {
    if (await isAccountLocked(supabase, phone, clinicId)) {
        return -1;
    }

    const attempt = await loadAttempt(supabase, phone, clinicId);

    return Math.max(0, PIN_CONFIG.MAX_ATTEMPTS - attempt.attempt_count);
}

export async function getLockoutMinutesRemaining(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<number> {
    const attempt = await loadAttempt(supabase, phone, clinicId);

    if (!attempt.locked_until) {
        return 0;
    }

    const msRemaining = attempt.locked_until.getTime() - Date.now();
    return Math.max(0, Math.ceil(msRemaining / 60000));
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
        if (await isAccountLocked(supabase, phone, clinicId)) {
            const minutesRemaining = await getLockoutMinutesRemaining(supabase, phone, clinicId);
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
            await recordFailedAttempt(supabase, phone, clinicId);
            return {
                success: false,
                error: "invalid_pin"
            };
        }

        // Prefer the doctor's own bcrypt PIN; the shared env PIN is a fallback
        // for clinics that have not set individual PINs yet.
        const isValid = await verifyPinForDoctor(supabase, phone, clinicId, normalizedPin);

        if (!isValid) {
            // Record failed attempt
            await recordFailedAttempt(supabase, phone, clinicId);

            const remainingAttempts = await getRemainingAttempts(supabase, phone, clinicId);

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
        await clearFailedAttempts(supabase, phone, clinicId);

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
 * Check the PIN against this doctor's own bcrypt hash.
 *
 * The shared env PIN is only consulted for a doctor with no hash, and only
 * when ALLOW_SHARED_DOCTOR_PIN is set. Left on, one leaked PIN opens every
 * account that has not set its own; admins issue PINs via the staff endpoint
 * instead.
 */
async function verifyPinForDoctor(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string,
    pin: string
): Promise<boolean> {
    try {
        const { data: doctor } = await supabase
            .from("doctors")
            .select("pin_hash")
            .eq("clinic_id", clinicId)
            .eq("phone", phone)
            .eq("is_active", true)
            .maybeSingle();

        if (doctor?.pin_hash) {
            return await verifyPassword(pin, doctor.pin_hash);
        }
    } catch (error) {
        debug("doctorAuth", "Per-doctor PIN lookup failed", {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    if (Deno.env.get("ALLOW_SHARED_DOCTOR_PIN") !== "true") {
        debug("doctorAuth", "No personal PIN set and shared PIN disabled", { phone });
        return false;
    }

    return validatePin(pin, clinicId);
}

/**
 * Record a failed authentication attempt
 * Increments attempt counter and locks account if max attempts reached
 */
async function recordFailedAttempt(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<void> {
    const attempt = await loadAttempt(supabase, phone, clinicId);

    attempt.attempt_count += 1;
    attempt.last_attempt_at = new Date();

    if (attempt.attempt_count >= PIN_CONFIG.MAX_ATTEMPTS) {
        attempt.is_locked = true;
        attempt.locked_until = new Date(Date.now() + PIN_CONFIG.LOCKOUT_MINUTES * 60 * 1000);

        debug("doctorAuth", "Account locked due to failed attempts", {
            phone,
            attempts: attempt.attempt_count
        });
    }

    try {
        const doctorId = await findDoctorId(supabase, phone, clinicId);

        if (!doctorId) {
            return;
        }

        const row = {
            failed_attempts: attempt.attempt_count,
            last_failed_at: attempt.last_attempt_at.toISOString(),
            locked_until: attempt.locked_until?.toISOString() ?? null
        };

        // login_rate_limits has no unique index on (user_id, user_type), so an
        // upsert with onConflict would be rejected by Postgres.
        const { data: existing } = await supabase
            .from("login_rate_limits")
            .select("id")
            .eq("user_id", doctorId)
            .eq("user_type", "doctor")
            .maybeSingle();

        if (existing) {
            await supabase
                .from("login_rate_limits")
                .update(row)
                .eq("user_id", doctorId)
                .eq("user_type", "doctor");
        } else {
            await supabase
                .from("login_rate_limits")
                .insert({ user_id: doctorId, user_type: "doctor", clinic_id: clinicId, ...row });
        }
    } catch (error) {
        debug("doctorAuth", "Could not persist failed attempt", {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

/**
 * Clear failed authentication attempts (after successful login)
 */
async function clearFailedAttempts(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<void> {
    delete __authAttemptsCache[getAuthCacheKey(phone, clinicId)];

    try {
        const doctorId = await findDoctorId(supabase, phone, clinicId);

        if (!doctorId) {
            return;
        }

        await supabase
            .from("login_rate_limits")
            .update({
                failed_attempts: 0,
                locked_until: null,
                updated_at: new Date().toISOString()
            })
            .eq("user_id", doctorId)
            .eq("user_type", "doctor");
    } catch (error) {
        debug("doctorAuth", "Could not clear failed attempts", {
            error: error instanceof Error ? error.message : String(error)
        });
    }
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
export async function getPinEntryPrompt(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string,
    language: string = "EN"
): Promise<string> {
    const remainingAttempts = await getRemainingAttempts(supabase, phone, clinicId);

    if (remainingAttempts === -1) {
        const minutesRemaining = await getLockoutMinutesRemaining(supabase, phone, clinicId);
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
