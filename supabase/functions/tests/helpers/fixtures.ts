/**
 * Shared seed data for handler tests.
 *
 * Two clinics exist in every fixture so tenant isolation can be asserted
 * without each test building its own second tenant.
 */

import type { SeedData } from "./fake-supabase.ts";
import type { WhatsAppSession, ExtractedMessage } from "../../shared/types.ts";

export const CLINIC_A = "aaaaaaaa-0000-0000-0000-000000000001";
export const CLINIC_B = "bbbbbbbb-0000-0000-0000-000000000002";

export const DOCTOR_A = "dddddddd-0000-0000-0000-00000000000a";
export const DOCTOR_B = "dddddddd-0000-0000-0000-00000000000b";

export const PATIENT_PHONE = "919000000001";
export const DOCTOR_PHONE = "919000000009";

/** A date far enough ahead to stay inside the 7-day booking window. */
export function tomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
}

export function today(): string {
    return new Date().toISOString().split("T")[0];
}

export interface FixtureOptions {
    doctorStatus?: string;
    /** Slot times already booked at clinic A. */
    bookedTimes?: string[];
}

export function seed(options: FixtureOptions = {}): SeedData {
    const status = options.doctorStatus ?? "AVAILABLE";
    const date = tomorrow();

    return {
        clinics: [
            {
                id: CLINIC_A,
                name: "Clinic A",
                is_active: true,
                timezone: "Asia/Kolkata",
                open_time: "09:00",
                close_time: "18:00",
                working_days: [1, 2, 3, 4, 5, 6, 0],
                enable_after_hours_reply: false,
                whatsapp_phone_number_id: "PHONE_A",
                whatsapp_access_token: "TOKEN_A",
                whatsapp_verify_token: "VERIFY_A",
                whatsapp_webhook_token: "HOOK_A"
            },
            {
                id: CLINIC_B,
                name: "Clinic B",
                is_active: true,
                timezone: "Asia/Kolkata",
                open_time: "09:00",
                close_time: "18:00",
                working_days: [1, 2, 3, 4, 5, 6, 0],
                enable_after_hours_reply: false,
                whatsapp_phone_number_id: "PHONE_B",
                whatsapp_access_token: "TOKEN_B",
                whatsapp_verify_token: "VERIFY_B",
                whatsapp_webhook_token: "HOOK_B"
            }
        ],
        doctors: [
            {
                id: DOCTOR_A,
                clinic_id: CLINIC_A,
                name: "Dr A Sharma",
                phone: DOCTOR_PHONE,
                email: "a@example.com",
                specialization: "General Physician",
                is_active: true,
                availability_status: status,
                pin_hash: null
            },
            {
                id: DOCTOR_B,
                clinic_id: CLINIC_B,
                name: "Dr B Rao",
                phone: "919000000010",
                email: "b@example.com",
                specialization: "Dermatologist",
                is_active: true,
                availability_status: "AVAILABLE",
                pin_hash: null
            }
        ],
        service_types: [
            { id: "svc-consult", code: "CONSULTATION", name: "Consultation", is_active: true }
        ],
        doctor_availability: [
            {
                clinic_id: CLINIC_A,
                doctor_id: DOCTOR_A,
                day_of_week: new Date(date).getDay(),
                start_time: "09:00",
                end_time: "18:00",
                slot_duration_minutes: 30,
                is_active: true
            }
        ],
        appointments: (options.bookedTimes ?? []).map((time, i) => ({
            id: `APT_SEED_${i}`,
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: "919111111111",
            patient_name: "Existing Patient",
            service_type_id: "svc-consult",
            appointment_date: date,
            appointment_time: time,
            status: "CONFIRMED"
        })),
        whatsapp_sessions: [],
        whatsapp_log: [],
        patients: [],
        waitlist: [],
        feedback: [],
        doctor_leaves: [],
        appointment_reminders: []
    };
}

/** A session row as the handlers expect to receive it. */
export function session(
    state: string,
    data: Record<string, unknown> = {},
    clinicId: string = CLINIC_A,
    phone: string = PATIENT_PHONE,
    role: WhatsAppSession["role"] = "PATIENT"
): WhatsAppSession {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000);

    return {
        id: `sess_${phone}_${state}`,
        phone,
        clinic_id: clinicId,
        role,
        state,
        data: data as Record<string, any>,
        metadata: {},
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        expires_at: expires.toISOString()
    };
}

/** A doctor session, which the doctor handler expects. */
export function doctorSession(
    state: string,
    data: Record<string, unknown> = {},
    clinicId: string = CLINIC_A,
    phone: string = DOCTOR_PHONE
): WhatsAppSession {
    return session(state, data, clinicId, phone, "DOCTOR");
}

/** A text message as extracted from a webhook payload. */
export function textMessage(text: string, _phone: string = PATIENT_PHONE): ExtractedMessage {
    return { type: "text", text };
}

/** A tap on an interactive button or list row. */
export function tap(id: string, _phone: string = PATIENT_PHONE): ExtractedMessage {
    return { type: "interactive", text: id };
}

/** A shared location pin. */
export function location(
    latitude: number,
    longitude: number,
    _phone: string = PATIENT_PHONE
): ExtractedMessage {
    return { type: "location", text: "", latitude, longitude };
}
