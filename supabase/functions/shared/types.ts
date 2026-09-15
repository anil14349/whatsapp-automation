/**
 * Type definitions for WhatsApp messages and internal data structures
 */

// ============================================================
// WHATSAPP MESSAGE TYPES
// ============================================================

export interface WhatsAppMessage {
    id: string;
    from: string;
    type: "text" | "interactive" | "location" | "image" | "document";
    text?: { body: string };
    interactive?: {
        type: "button_reply" | "list_reply";
        button_reply?: { id: string; title: string };
        list_reply?: { id: string; title: string };
    };
    location?: {
        latitude: number;
        longitude: number;
    };
}

export interface WhatsAppContact {
    profile?: {
        name: string;
    };
}

export interface WhatsAppMetadata {
    phone_number_id: string;
}

export interface WhatsAppWebhookValue {
    messages: WhatsAppMessage[];
    contacts?: WhatsAppContact[];
    metadata?: WhatsAppMetadata;
}

export interface ExtractedMessage {
    type: string;
    text: string;
    latitude?: number;
    longitude?: number;
}

// ============================================================
// INTERNAL TYPES
// ============================================================

export interface WhatsAppSession {
    id: string;
    phone: string;
    clinic_id: string;
    role: "PATIENT" | "DOCTOR" | "HOME_COLLECTION_PERSON";
    state: string;
    data: Record<string, any>;
    metadata: Record<string, any>;
    created_at: string;
    updated_at: string;
    expires_at: string;
}

export interface WhatsAppLogEntry {
    direction: "INBOUND" | "OUTBOUND" | "WEBHOOK" | "ERROR";
    phone?: string;
    name?: string;
    status?: string;
    message?: string;
    message_id?: string;
    phone_number_id?: string;
    metadata?: Record<string, any>;
}

export interface MessageDedup {
    message_id: string;
    phone: string;
    status: "processing" | "completed" | "failed";
    result?: Record<string, any>;
}

export interface ProcessMessageContext {
    messageId: string;
    senderPhone: string;
    senderName: string;
    messageText: string;
    messageType: string;
    latitude?: number;
    longitude?: number;
    /** Clinic that owns the WhatsApp number the message arrived on. */
    clinicId?: string;
}

// ============================================================
// APPOINTMENT TYPES
// ============================================================

export interface AppointmentRecord {
    id: string;
    date: string;
    time: string;
    doctor_id: string;
    patient_name: string;
    phone: string;
    status: string;
    calendar_event_id?: string;
    patient_id?: string;
    notes?: string;
}

/** A row of home_collection_reminders. */
export interface HomeCollectionReminder {
    id: string;
    clinic_id: string;
    request_id: string;
    patient_phone: string;
    scheduled_time: string;
    status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
    message_id?: string | null;
    error_message?: string | null;
    preferred_language?: string | null;
    attempts: number;
    max_attempts: number;
    sent_at?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface DoctorRecord {
    id: string;
    name: string;
    clinic: string;
    calendar_id: string;
    whatsapp: string;
    appointment_duration_minutes: number;
}

// ============================================================
// API RESPONSE TYPES
// ============================================================

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface BookingResponse extends ApiResponse {
    appointmentId?: string;
    date?: string;
    time?: string;
    doctorName?: string;
}

// ============================================================
// SETTINGS & CONFIG
// ============================================================

export interface AppSettings {
    LOG_RETENTION_DAYS: number;
    LOG_MAX_ROWS: number;
    SESSION_TTL_HOURS: number;
    ENABLE_APPOINTMENT_REMINDERS: boolean;
    REMINDER_HOURS_BEFORE: number;
    ENABLE_AFTER_HOURS_REPLY: boolean;
    CLINIC_OPEN_TIME: string;
    CLINIC_CLOSE_TIME: string;
    CLINIC_WORKING_DAYS: string[];
    AUTO_COMPLETE_PAST_APPOINTMENTS: boolean;
    AUTO_COMPLETE_HOURS_AFTER: number;
    FEEDBACK_SAMPLING_RATE: number;
    COST_OPTIMIZATION_SKIP_24H_REMINDER: boolean;
}

export interface ClinicConfig {
    timezone: string;
    openTime: string;
    closeTime: string;
    workingDays: string[];
    phoneNumberId: string;
}
