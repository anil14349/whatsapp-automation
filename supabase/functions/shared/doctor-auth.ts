import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePin, PIN_CONFIG } from "./config.ts";
import { verifyPassword } from "./bcrypt-password.ts";
import { BUTTON_IDS } from "./button-ids.ts";
import { debug } from "./logger.ts";
import {
    attemptsRemaining,
    clearAttemptCache,
    clearFailures,
    isLockedOut,
    lockoutMinutesRemaining,
    recordFailure
} from "./login-attempts.ts";

/**
 * Doctor Portal Authentication
 * Manages PIN-based login with rate limiting and attempt tracking
 *
 * The counting and locking is shared with collectors; only finding the account
 * and checking the PIN is doctor-specific.
 */

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
 * Check if doctor account is currently locked due to failed attempts
 */
export async function isAccountLocked(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<boolean> {
    const doctorId = await findDoctorId(supabase, phone, clinicId);

    return doctorId ? await isLockedOut(supabase, doctorId, "doctor") : false;
}

export async function getLockoutMinutesRemaining(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<number> {
    const doctorId = await findDoctorId(supabase, phone, clinicId);

    return doctorId ? await lockoutMinutesRemaining(supabase, doctorId, "doctor") : 0;
}

async function recordFailedAttempt(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<void> {
    const doctorId = await findDoctorId(supabase, phone, clinicId);

    if (doctorId) {
        await recordFailure(supabase, doctorId, "doctor", clinicId);
    }
}

async function clearFailedAttempts(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<void> {
    const doctorId = await findDoctorId(supabase, phone, clinicId);

    if (doctorId) {
        await clearFailures(supabase, doctorId, "doctor");
    }
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

    const doctorId = await findDoctorId(supabase, phone, clinicId);

    return doctorId
        ? await attemptsRemaining(supabase, doctorId, "doctor")
        : PIN_CONFIG.MAX_ATTEMPTS;
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
 * Clear auth cache (for testing)
 */
export function clearAuthCache(): void {
    clearAttemptCache();
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

/**
 * Self-service reset trades a factor for convenience: anyone holding the
 * doctor's unlocked phone can set a new PIN. Clinics that would rather route
 * resets through an admin can turn it off.
 */
export function selfServicePinResetEnabled(): boolean {
    return Deno.env.get("ALLOW_SELF_SERVICE_PIN_RESET") !== "false";
}

/**
 * Ask for the PIN, offering a way out for doctors who have forgotten it.
 *
 * Shared so the greeting and the login handler present the same thing; a
 * text-only greeting left doctors with no visible way to recover.
 */
export async function sendPinPrompt(
    supabase: SupabaseClient,
    whatsappClient: {
        sendTextMessage: (to: string, body: string, supabase?: SupabaseClient) => Promise<string>;
        sendInteractiveButtonMessage: (
            to: string,
            body: string,
            buttons: Array<{ id: string; title: string }>,
            supabase?: SupabaseClient
        ) => Promise<string>;
    },
    phone: string,
    clinicId: string,
    language: string = "EN"
): Promise<void> {
    const prompt = await getPinEntryPrompt(supabase, phone, clinicId, language);

    if (!selfServicePinResetEnabled()) {
        await whatsappClient.sendTextMessage(phone, prompt, supabase);
        return;
    }

    await whatsappClient.sendInteractiveButtonMessage(
        phone,
        prompt,
        [
            {
                id: BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN,
                title: language === "EN" ? "Forgot PIN" : "PIN भूल गए"
            }
        ],
        supabase
    );
}
