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
