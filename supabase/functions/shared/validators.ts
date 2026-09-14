import { WhatsAppMessage, ExtractedMessage } from "./types.ts";

/**
 * Verify webhook token against configured token
 */
export function verifyWebhookToken(token: string | null): boolean {
    const expectedToken = Deno.env.get("WHATSAPP_WEBHOOK_POST_TOKEN");

    // Fail closed: reject if token not configured
    if (!expectedToken) {
        console.error("WHATSAPP_WEBHOOK_POST_TOKEN not configured");
        return false;
    }

    return token === expectedToken;
}

/**
 * Extract message content from WhatsApp message payload
 */
export function extractInboundMessage(message: WhatsAppMessage): ExtractedMessage {
    const result: ExtractedMessage = {
        type: message.type || "text",
        text: ""
    };

    switch (message.type) {
        case "text":
            result.text = message.text?.body || "";
            break;

        case "interactive":
            if (message.interactive?.type === "button_reply") {
                result.text = message.interactive.button_reply?.id || "";
            } else if (message.interactive?.type === "list_reply") {
                result.text = message.interactive.list_reply?.id || "";
            }
            break;

        case "location":
            if (message.location) {
                result.latitude = message.location.latitude;
                result.longitude = message.location.longitude;
            }
            break;

        default:
            result.text = "";
    }

    return result;
}

/**
 * Normalize WhatsApp phone number
 * Accepts: 919876543210, +919876543210, 91-9876543210
 * Returns: 919876543210 (numeric only)
 */
export function normalizePhoneNumber(phone: string): string {
    if (!phone) return "";

    // Remove non-numeric characters except leading +
    let normalized = phone.replace(/[^\d+]/g, "");

    // Remove + prefix
    if (normalized.startsWith("+")) {
        normalized = normalized.substring(1);
    }

    return normalized;
}

/**
 * Check if phone numbers match (after normalization)
 */
export function phonesMatch(phoneA: string, phoneB: string): boolean {
    return normalizePhoneNumber(phoneA) === normalizePhoneNumber(phoneB);
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
    const normalized = normalizePhoneNumber(phone);

    // Should be 10-15 digits (international format)
    return /^\d{10,15}$/.test(normalized);
}

/**
 * Validate date string (YYYY-MM-DD)
 */
export function isValidISODate(dateString: string): boolean {
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return false;
    }

    const date = new Date(dateString + "T00:00:00Z");
    return !isNaN(date.getTime());
}

/**
 * Validate booking date is within allowed range (today to max 7 days from today)
 * Returns: { valid: boolean, error?: string }
 * Error messages:
 * - "past" if date is in the past
 * - "too_far" if date is more than 7 days in the future
 */
export function isValidBookingDate(dateString: string): { valid: boolean; error?: string } {
    // Validate ISO format first
    if (!isValidISODate(dateString)) {
        return { valid: false, error: "invalid_format" };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    const bookingDate = new Date(dateString + "T00:00:00Z");
    bookingDate.setUTCHours(0, 0, 0, 0); // Normalize to UTC start of day

    // Check if date is in the past
    if (bookingDate < today) {
        return { valid: false, error: "past" };
    }

    // Check if date is more than 7 days in the future
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 7);

    if (bookingDate > maxDate) {
        return { valid: false, error: "too_far" };
    }

    return { valid: true };
}

/**
 * Format booking date validation error message for user display
 */
export function formatBookingDateErrorMessage(error: string, language: string = "EN"): string {
    if (error === "past") {
        return language === "EN"
            ? "❌ Cannot book appointments in the past. Please select a future date."
            : "❌ अतीत में नियुक्तियों को बुक नहीं कर सकते। कृपया भविष्य की तारीख चुनें।";
    }

    if (error === "too_far") {
        return language === "EN"
            ? "❌ Appointments can only be booked up to 7 days in advance. Please select an earlier date."
            : "❌ नियुक्तियों को केवल 7 दिन पहले बुक किया जा सकता है। कृपया पहली तारीख चुनें।";
    }

    if (error === "invalid_format") {
        return language === "EN"
            ? "❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2026-09-20)"
            : "❌ अमान्य तारीख प्रारूप। कृपया YYYY-MM-DD का उपयोग करें (उदा. 2026-09-20)";
    }

    return language === "EN"
        ? "❌ Invalid date. Please try again."
        : "❌ अमान्य तारीख। कृपया दोबारा कोशिश करें।";
}

/**
 * Validate time string (HH:MM or H:MM)
 */
export function isValidTimeString(timeString: string): boolean {
    if (!timeString) return false;

    // Accepts HH:MM, H:MM, 9:00, 09:00, etc.
    const match = timeString.match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return false;

    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);

    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Validate patient name
 * Must be 2-100 characters, alphanumeric + spaces
 */
export function isValidPatientName(name: string): boolean {
    if (!name || typeof name !== "string") return false;

    const trimmed = name.trim();

    if (trimmed.length < 2 || trimmed.length > 100) {
        return false;
    }

    // Allow letters, digits, spaces, hyphens
    // Support Unicode letters for non-English names
    return /^[\p{L}\p{N}\s\-'.,]+$/u.test(trimmed);
}

/**
 * Validate doctor ID format
 */
export function isValidDoctorId(doctorId: string): boolean {
    if (!doctorId) return false;
    // Assuming doctor IDs are alphanumeric
    return /^[A-Za-z0-9_-]{1,50}$/.test(doctorId);
}

/**
 * Validate appointment ID format
 */
export function isValidAppointmentId(appointmentId: string): boolean {
    if (!appointmentId) return false;
    return /^[A-Za-z0-9_-]{1,50}$/.test(appointmentId);
}

/**
 * Extract doctor ID from message
 * Handles: "1", "doctor_1", "D001", etc.
 */
export function extractDoctorIdFromMessage(message: string): string | null {
    if (!message) return null;

    const trimmed = message.trim();

    // Direct numeric: "1", "2"
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }

    // Prefixed: "D001", "doctor_1"
    const match = trimmed.match(/^[A-Za-z_]*(\w+)$/);
    if (match) {
        return match[1];
    }

    return null;
}

/**
 * Validate appointment status value
 */
export const VALID_APPOINTMENT_STATUSES = [
    "pending",
    "confirmed",
    "completed",
    "no-show",
    "cancelled",
    "rescheduled"
];

export function isValidAppointmentStatus(status: string): boolean {
    return VALID_APPOINTMENT_STATUSES.includes(status?.toLowerCase());
}

/**
 * Normalize appointment status
 */
export function normalizeAppointmentStatus(status: string): string {
    if (!status) return "pending";

    const normalized = status.toLowerCase().trim();

    // Map variations
    const statusMap: Record<string, string> = {
        "pending": "pending",
        "booked": "confirmed",
        "confirmed": "confirmed",
        "scheduled": "confirmed",
        "done": "completed",
        "completed": "completed",
        "no_show": "no-show",
        "noshow": "no-show",
        "no-show": "no-show",
        "cancelled": "cancelled",
        "canceled": "cancelled",
        "rescheduled": "rescheduled"
    };

    return statusMap[normalized] || "pending";
}

/**
 * Check if appointment can be cancelled
 */
export function canCancelAppointmentStatus(status: string): boolean {
    const normalized = normalizeAppointmentStatus(status);
    return ["pending", "confirmed", "scheduled"].includes(normalized);
}

/**
 * Check if appointment is in terminal state (can't be modified)
 */
export function isTerminalAppointmentStatus(status: string): boolean {
    const normalized = normalizeAppointmentStatus(status);
    return ["completed", "no-show", "cancelled"].includes(normalized);
}
