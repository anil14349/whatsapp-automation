import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import MultiClinicSupabaseClient from "./multi-clinic-supabase-client.ts";
import {
    logError,
    recordAuditEvent,
    debug
} from "./logger.ts";
import { isValidISODate, isValidTimeString } from "./validators.ts";

/**
 * Appointment Business Logic
 *
 * Cancelling and rescheduling for the WhatsApp flow. Booking lives in
 * MultiClinicSupabaseClient.createAppointment; the version that used to sit
 * here still referenced the retired Google Sheets and Calendar clients.
 */

export interface AppointmentResponse {
    success: boolean;
    appointmentId?: string;
    message: string;
    error?: string;
}

/**
 * Cancel an appointment
 */
export async function cancelAppointment(
    supabase: SupabaseClient,
    appointmentId: string,
    reason?: string
): Promise<AppointmentResponse> {
    try {
        const { data: existing, error: fetchError } = await supabase
            .from("appointments")
            .select("id, status")
            .eq("id", appointmentId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!existing) {
            return {
                success: false,
                message: "Appointment not found",
                error: "Invalid appointment ID"
            };
        }

        if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
            return {
                success: false,
                message: `Cannot cancel ${String(existing.status).toLowerCase()} appointment`,
                error: "Invalid appointment status"
            };
        }

        const { error: updateError } = await supabase
            .from("appointments")
            .update({
                status: "CANCELLED",
                cancellation_reason: reason || null,
                updated_at: new Date().toISOString()
            })
            .eq("id", appointmentId);

        if (updateError) throw updateError;

        // Log in Supabase
        await recordAuditEvent(
            supabase,
            "appointment_cancelled",
            "patient",
            "appointment",
            appointmentId,
            { status: existing.status },
            { status: "CANCELLED", reason }
        );

        return {
            success: true,
            message: "Appointment cancelled successfully"
        };
    } catch (error) {
        await logError(supabase, error instanceof Error ? error : new Error(String(error)), {
            context: "cancelAppointment",
            appointmentId
        });

        return {
            success: false,
            message: "Failed to cancel appointment",
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Reschedule an appointment
 */
export async function rescheduleAppointment(
    supabase: SupabaseClient,
    appointmentId: string,
    newDate: string,
    newTime: string
): Promise<AppointmentResponse> {
    const client = new MultiClinicSupabaseClient(
        Deno.env.get("SUPABASE_URL") || "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    try {
        // Validate new date/time
        if (!isValidISODate(newDate) || !isValidTimeString(newTime)) {
            return {
                success: false,
                message: "Invalid date or time format",
                error: "Date must be YYYY-MM-DD, time must be HH:MM"
            };
        }

        const { data: existing, error: fetchError } = await supabase
            .from("appointments")
            .select("id, status, clinic_id, doctor_id, patient_phone, appointment_date, appointment_time")
            .eq("id", appointmentId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!existing) {
            return {
                success: false,
                message: "Appointment not found",
                error: "Invalid appointment ID"
            };
        }

        // Can't reschedule completed or cancelled appointments
        if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
            return {
                success: false,
                message: `Cannot reschedule ${String(existing.status).toLowerCase()} appointment`,
                error: "Invalid appointment status"
            };
        }

        const slotAvailable = await client.isSlotAvailable(
            existing.clinic_id,
            existing.doctor_id,
            newDate,
            newTime
        );

        if (!slotAvailable) {
            return {
                success: false,
                message: "New time slot is not available",
                error: "Slot not available"
            };
        }

        const { error: updateError } = await supabase
            .from("appointments")
            .update({
                appointment_date: newDate,
                appointment_time: newTime,
                updated_at: new Date().toISOString()
            })
            .eq("id", appointmentId);

        if (updateError) throw updateError;

        // Log in Supabase
        await recordAuditEvent(
            supabase,
            "appointment_rescheduled",
            existing.patient_phone,
            "appointment",
            appointmentId,
            { date: existing.appointment_date, time: existing.appointment_time },
            { date: newDate, time: newTime }
        );

        return {
            success: true,
            message: `Appointment rescheduled to ${newDate} at ${newTime}`
        };
    } catch (error) {
        await logError(supabase, error instanceof Error ? error : new Error(String(error)), {
            context: "rescheduleAppointment",
            appointmentId
        });

        return {
            success: false,
            message: "Failed to reschedule appointment",
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
