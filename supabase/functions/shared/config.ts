/**
 * Clinic configuration read from the environment.
 *
 * Roles are NOT here: who is a doctor or a collector is per clinic and lives
 * in the database. Phone lists in env granted staff access globally and were
 * a second, unmaintained way in.
 *
 * The same argument retired HOME_COLLECTION_MIN_LEAD_HOURS and
 * MAX_COLLECTIONS_PER_COLLECTOR_PER_DAY. Both were per-clinic policy sitting
 * in a deployment-wide variable, both had no callers left, and both already
 * had a per-clinic home: `clinic_services.min_booking_window_hours` and
 * `sample_collectors.max_collections_per_day`.
 */

/**
 * PIN AUTHENTICATION CONFIGURATION
 * ================================
 * Supports two modes:
 * 1. Single clinic PIN (simpler): Set DOCTOR_PORTAL_PIN
 * 2. Multi-clinic PINs (advanced): Set DOCTOR_PORTAL_PINS as JSON
 *
 * Examples:
 * DOCTOR_PORTAL_PIN=123456  (all doctors use same PIN)
 * DOCTOR_PORTAL_PINS={"clinic_1":"123456","clinic_2":"654321"}
 */

/**
 * Get the PIN for a clinic
 * Supports both single PIN and multi-clinic PIN configuration
 */
export function getClinicPin(clinicId: string): string | null {
    // Try multi-clinic PINs first
    const multiClinicPinsString = Deno.env.get("DOCTOR_PORTAL_PINS");
    if (multiClinicPinsString) {
        try {
            const pinsMap = JSON.parse(multiClinicPinsString);
            if (pinsMap[clinicId]) {
                return pinsMap[clinicId];
            }
        } catch {
            // Fall through to single PIN
        }
    }

    // Fall back to single PIN for all clinics
    return Deno.env.get("DOCTOR_PORTAL_PIN") || null;
}

/**
 * Validate PIN with constant-time comparison to prevent timing attacks
 * Returns: true if PIN matches, false otherwise
 */
export function validatePin(providedPin: string, clinicId: string): boolean {
    const expectedPin = getClinicPin(clinicId);

    if (!expectedPin) {
        return false;
    }

    // Constant-time string comparison to prevent timing attacks
    // Both strings must be same length, compare character by character
    const normalizedProvidedPin = String(providedPin || "").trim();
    const normalizedExpectedPin = String(expectedPin).trim();

    // Check length first (still constant time for actual comparison)
    if (normalizedProvidedPin.length !== normalizedExpectedPin.length) {
        return false;
    }

    let matches = true;
    for (let i = 0; i < normalizedExpectedPin.length; i++) {
        if (normalizedProvidedPin[i] !== normalizedExpectedPin[i]) {
            matches = false;
        }
    }

    return matches;
}

/**
 * PIN Configuration for environment setup
 */
export const PIN_CONFIG = {
    MAX_ATTEMPTS: 3,
    LOCKOUT_MINUTES: 15,
    PIN_LENGTH_MIN: 4,
    PIN_LENGTH_MAX: 8
};
