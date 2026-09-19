import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import MultiClinicSupabaseClient from "./multi-clinic-supabase-client.ts";
import {
    logError,
    recordAuditEvent,
    debug
} from "./logger.ts";
import { isValidISODate, isValidTimeString } from "./validators.ts";
import {
    rescheduleAppointmentReminders,
    skipAppointmentReminders
} from "./appointment-reminders.ts";
import { getServiceById } from "./clinic-services.ts";
import { isClinicServiceSlotAvailable } from "./clinic-slots.ts";
import { WaitlistHandler } from "./handlers/waitlist-handler.ts";
import type { WhatsAppClient } from "./whatsapp-client.ts";

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
    clinicId: string,
    reason?: string,
    actor: string = "patient",
    /** Supplied by callers that can send: freeing a slot tells the waitlist. */
    notifier?: WhatsAppClient
): Promise<AppointmentResponse> {
    try {
        // Scoped by clinic: an appointment id alone must never be enough to
        // cancel another clinic's booking.
        const { data: existing, error: fetchError } = await supabase
            .from("appointments")
            .select("id, status, doctor_id, appointment_date, appointment_time")
            .eq("id", appointmentId)
            .eq("clinic_id", clinicId)
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

        const { data: updated, error: updateError } = await supabase
            .from("appointments")
            .update({
                status: "CANCELLED",
                cancellation_reason: reason || null,
                updated_at: new Date().toISOString()
            })
            .eq("id", appointmentId)
            .eq("clinic_id", clinicId)
            // The same two the read above refused, repeated on the write: the
            // row can be completed by the doctor between the check and here.
            .neq("status", "CANCELLED")
            .neq("status", "COMPLETED")
            .select("id");

        if (updateError) throw updateError;

        if (!updated || updated.length === 0) {
            return {
                success: false,
                message: "That appointment changed while you were cancelling it",
                error: "Invalid appointment status"
            };
        }

        // Here rather than in the callers: the WhatsApp flow remembered to do
        // this and the portal did not, so cancelling at the desk still left the
        // patient a reminder for a visit that was no longer happening.
        await skipAppointmentReminders(supabase, appointmentId);

        // Same reason: the slot has just come free, and only the WhatsApp flow
        // was telling anyone waiting for it. Cancelling at the desk left the
        // waitlist untouched, which is the half of the feature nobody sees.
        if (notifier && existing.doctor_id) {
            const waitlist = new WaitlistHandler(supabase, notifier);

            for (const time of [existing.appointment_time, "ANY"]) {
                await waitlist.notifyWaitlistOnCancellation(
                    existing.doctor_id,
                    existing.appointment_date,
                    time,
                    clinicId
                );
            }
        }

        // Log in Supabase
        await recordAuditEvent(
            supabase,
            "appointment_cancelled",
            actor,
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
        await logError(
            supabase,
            "cancelAppointment",
            error instanceof Error ? error : new Error(String(error)),
            { appointmentId }
        );

        return {
            success: false,
            message: "Failed to cancel appointment",
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Is the requested slot free for this appointment?
 *
 * A doctor-free service (sample collection, most diagnostics) has no diary to
 * consult, so asking the doctor-slot check about it returned "Doctor not found:
 * null" and the patient was told the slot was taken. Its capacity lives on the
 * clinic's own service hours instead.
 */
async function isNewSlotFree(
    supabase: SupabaseClient,
    client: MultiClinicSupabaseClient,
    existing: { clinic_id: string; doctor_id: string | null; service_type_id: string | null },
    newDate: string,
    newTime: string
): Promise<boolean> {
    if (existing.doctor_id) {
        return await client.isSlotAvailable(
            existing.clinic_id,
            existing.doctor_id,
            newDate,
            newTime,
            existing.service_type_id ?? undefined
        );
    }

    const service = existing.service_type_id
        ? await getServiceById(supabase, existing.clinic_id, existing.service_type_id)
        : null;

    // A service turned off since booking leaves nothing to measure capacity
    // against. Allow the move: the appointment already exists, and stranding
    // the patient on a slot they cannot leave is the worse outcome.
    if (!service) {
        debug("rescheduleAppointment", "No service to check capacity against, allowing", {
            clinicId: existing.clinic_id,
            serviceTypeId: existing.service_type_id
        });
        return true;
    }

    return await isClinicServiceSlotAvailable(
        supabase,
        existing.clinic_id,
        service,
        newDate,
        newTime
    );
}

/**
 * Reschedule an appointment
 */
export async function rescheduleAppointment(
    supabase: SupabaseClient,
    appointmentId: string,
    clinicId: string,
    newDate: string,
    newTime: string,
    actor: string = "patient"
): Promise<AppointmentResponse> {
    const client = new MultiClinicSupabaseClient(
        Deno.env.get("SUPABASE_URL") || "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
        // Reuse the caller's client; building a second from env made every
        // test that reached here talk to the real network.
        supabase
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
            .select("id, status, clinic_id, doctor_id, service_type_id, patient_phone, appointment_date, appointment_time")
            .eq("id", appointmentId)
            .eq("clinic_id", clinicId)
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

        const slotAvailable = await isNewSlotFree(
            supabase,
            client,
            existing,
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
            .eq("id", appointmentId)
            .eq("clinic_id", clinicId);

        if (updateError) throw updateError;

        // Reminders are scheduled off the appointment time, so moving one
        // without them leaves a reminder pointing at the old slot.
        await rescheduleAppointmentReminders(
            supabase,
            clinicId,
            appointmentId,
            newDate,
            newTime
        );

        // Log in Supabase
        await recordAuditEvent(
            supabase,
            "appointment_rescheduled",
            actor === "patient" ? existing.patient_phone : actor,
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
        await logError(
            supabase,
            "rescheduleAppointment",
            error instanceof Error ? error : new Error(String(error)),
            { appointmentId }
        );

        return {
            success: false,
            message: "Failed to reschedule appointment",
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
