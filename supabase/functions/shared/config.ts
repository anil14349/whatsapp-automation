/**
 * Role Configuration
 * Maps phone numbers to user roles (Doctor, Sample Collector, or Patient)
 * Phone numbers not in these lists default to PATIENT role
 */

/**
 * Get list of authorized doctor phone numbers from environment
 * Format: comma-separated phone numbers
 * Example: +919876543210,+919876543211
 */
export function getDoctorPhones(): string[] {
    const phonesString = Deno.env.get("DOCTOR_PHONES") || "";
    return phonesString
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}

/**
 * Get list of authorized sample collector phone numbers from environment
 * Format: comma-separated phone numbers
 * Example: +919876543220,+919876543221
 */
export function getSampleCollectorPhones(): string[] {
    const phonesString = Deno.env.get("SAMPLE_COLLECTOR_PHONES") || "";
    return phonesString
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}

/**
 * Minimum notice before a home collection window can be offered today
 */
export function getHomeCollectionMinLeadHours(): number {
    const hours = Number(Deno.env.get("HOME_COLLECTION_MIN_LEAD_HOURS") || "2");
    return isFinite(hours) && hours >= 0 ? hours : 2;
}

/**
 * How many collections a single collector can take in one day
 */
export function getMaxCollectionsPerCollectorPerDay(): number {
    const limit = Number(Deno.env.get("MAX_COLLECTIONS_PER_COLLECTOR_PER_DAY") || "8");
    return isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
}

/**
 * Determine user role based on phone number
 * Returns: "DOCTOR" | "HOME_COLLECTION_PERSON" | "PATIENT"
 */
export function getRoleByPhone(phone: string): "DOCTOR" | "HOME_COLLECTION_PERSON" | "PATIENT" {
    const normalizedPhone = phone.trim();

    if (getDoctorPhones().includes(normalizedPhone)) {
        return "DOCTOR";
    }

    if (getSampleCollectorPhones().includes(normalizedPhone)) {
        return "HOME_COLLECTION_PERSON";
    }

    return "PATIENT";
}

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

/**
 * Check if phone is a doctor
 */
export function isDoctor(phone: string): boolean {
    return getRoleByPhone(phone) === "DOCTOR";
}

/**
 * Check if phone is a sample collector
 */
export function isSampleCollector(phone: string): boolean {
    return getRoleByPhone(phone) === "HOME_COLLECTION_PERSON";
}

/**
 * Check if phone is a patient
 */
export function isPatient(phone: string): boolean {
    return getRoleByPhone(phone) === "PATIENT";
}
