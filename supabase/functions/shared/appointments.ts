import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import MultiClinicSupabaseClient from "./multi-clinic-supabase-client.ts";
import {
    logWhatsAppMessage,
    logError,
    recordAuditEvent,
    debug
} from "./logger.ts";
import { isValidISODate, isValidTimeString } from "./validators.ts";

/**
 * Appointment Business Logic
 * Handles booking, cancelling, and rescheduling appointments
 * Integrates with Google Sheets (data) and Google Calendar (availability)
 */

export interface AppointmentRequest {
    patientPhone: string;
    patientName: string;
    doctorId: string;
    date: string; // YYYY-MM-DD
    time: string; // HH:MM
    notes?: string;
}

export interface AppointmentResponse {
    success: boolean;
    appointmentId?: string;
    message: string;
    error?: string;
}

/**
 * Book an appointment
 */
export async function bookAppointment(
    supabase: SupabaseClient,
    whatsappClient: any,
    request: AppointmentRequest
): Promise<AppointmentResponse> {
    const client = new MultiClinicSupabaseClient(
        Deno.env.get("SUPABASE_URL") || "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    try {
        // Validate input
        if (!isValidISODate(request.date)) {
            return {
                success: false,
                message: "Invalid date format",
                error: "Date must be YYYY-MM-DD"
            };
        }

        if (!isValidTimeString(request.time)) {
            return {
                success: false,
                message: "Invalid time format",
                error: "Time must be HH:MM"
            };
        }

        // Check date is in future
        const appointmentDate = new Date(request.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (appointmentDate < today) {
            return {
                success: false,
                message: "Cannot book appointment in the past",
                error: "Selected date is in the past"
            };
        }

        // Get doctor details
        const doctor = await sheets.getDoctorById(request.doctorId);
        if (!doctor) {
            return {
                success: false,
                message: "Doctor not found",
                error: `Doctor ID ${request.doctorId} not found`
            };
        }

        debug("appointments", "Got doctor details", {
            doctorId: request.doctorId,
            doctorName: doctor.name
        });

        // Check if doctor has availability on this day
        const dayOfWeek = appointmentDate.toLocaleDateString("en-US", {
            weekday: "short"
        });
        const availability = await sheets.getDoctorAvailability(
            request.doctorId,
            dayOfWeek
        );

        if (availability.length === 0) {
            return {
                success: false,
                message: `${doctor.name} is not available on ${dayOfWeek}s`,
                error: "Doctor unavailable on selected day"
            };
        }

        // Check if doctor is on leave
        const leaves = await sheets.getDoctorLeaves(request.doctorId);
        const isOnLeave = leaves.some((leave: any) => {
            const leaveStart = new Date(leave.startDate);
            const leaveEnd = new Date(leave.endDate);
            return appointmentDate >= leaveStart && appointmentDate <= leaveEnd;
        });

        if (isOnLeave) {
            return {
                success: false,
                message: `${doctor.name} is on leave on this date`,
                error: "Doctor on leave"
            };
        }

        // Acquire slot lock (prevent double-booking)
        const lockAcquired = await calendar.acquireSlotLock(
            supabase,
            request.doctorId,
            request.date,
            request.time
        );

        if (!lockAcquired) {
            return {
                success: false,
                message: "Slot is no longer available",
                error: "Slot lock failed"
            };
        }

        // Check if slot is available in calendar
        const slotAvailable = await calendar.isSlotAvailable(
            doctor.calendarId,
            request.date,
            request.time,
            30
        );

        if (!slotAvailable) {
            await calendar.releaseSlotLock(
                supabase,
                request.doctorId,
                request.date,
                request.time
            );

            return {
                success: false,
                message: "This time slot is not available",
                error: "Slot not available"
            };
        }

        // Get or create patient
        const patient = await sheets.getOrCreatePatient(
            request.patientPhone,
            request.patientName
        );

        if (!patient) {
            await calendar.releaseSlotLock(
                supabase,
                request.doctorId,
                request.date,
                request.time
            );

            return {
                success: false,
                message: "Failed to create patient record",
                error: "Patient creation failed"
            };
        }

        // Generate appointment ID
        const appointmentId = `APT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create event in calendar
        const eventId = await calendar.createEvent(doctor.calendarId, {
            title: `Appointment - ${request.patientName}`,
            description: `Patient: ${request.patientName}\nPhone: ${request.patientPhone}\nNotes: ${request.notes || "No notes"}`,
            startDate: request.date,
            startTime: request.time,
            endDate: request.date,
            endTime: getEndTime(request.time, 30),
            attendeeEmail: patient.email,
            location: "ABC Clinic"
        });

        if (!eventId) {
            await calendar.releaseSlotLock(
                supabase,
                request.doctorId,
                request.date,
                request.time
            );

            return {
                success: false,
                message: "Failed to create calendar event",
                error: "Calendar creation failed"
            };
        }

        // Create appointment in Google Sheets
        const appointmentCreated = await sheets.createAppointment({
            appointmentId,
            doctorId: request.doctorId,
            patientPhone: request.patientPhone,
            patientName: request.patientName,
            date: request.date,
            time: request.time,
            status: "CONFIRMED",
            notes: request.notes,
            calendarEventId: eventId
        });

        if (!appointmentCreated) {
            // Rollback calendar event
            await calendar.deleteEvent(doctor.calendarId, eventId);
            await calendar.releaseSlotLock(
                supabase,
                request.doctorId,
                request.date,
                request.time
            );

            return {
                success: false,
                message: "Failed to save appointment",
                error: "Sheet creation failed"
            };
        }

        // Release slot lock (booking complete)
        await calendar.releaseSlotLock(
            supabase,
            request.doctorId,
            request.date,
            request.time
        );

        // Log in Supabase
        await recordAuditEvent(supabase, {
            action: "appointment_created",
            actor: request.patientPhone,
            entityType: "appointment",
            entityId: appointmentId,
            beforeState: null,
            afterState: {
                doctor: doctor.name,
                date: request.date,
                time: request.time,
                status: "CONFIRMED"
            }
        });

        // Log message
        await logWhatsAppMessage(supabase, {
            direction: "OUTBOUND",
            phone: request.patientPhone,
            name: request.patientName,
            status: "APPOINTMENT_BOOKED",
            message: `Appointment confirmed with ${doctor.name} on ${request.date} at ${request.time}`
        });

        return {
            success: true,
            appointmentId,
            message: `Appointment booked successfully with ${doctor.name} on ${request.date} at ${request.time}`
        };
    } catch (error) {
        await logError(supabase, error instanceof Error ? error : new Error(String(error)), {
            context: "bookAppointment",
            request
        });

        return {
            success: false,
            message: "Failed to book appointment",
            error: error instanceof Error ? error.message : String(error)
        };
    }
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
        await recordAuditEvent(supabase, {
            action: "appointment_cancelled",
            actor: "patient",
            entityType: "appointment",
            entityId: appointmentId,
            beforeState: { status: existing.status },
            afterState: { status: "CANCELLED", reason }
        });

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
        await recordAuditEvent(supabase, {
            action: "appointment_rescheduled",
            actor: existing.patient_phone,
            entityType: "appointment",
            entityId: appointmentId,
            beforeState: { date: existing.appointment_date, time: existing.appointment_time },
            afterState: { date: newDate, time: newTime }
        });

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

/**
 * Get available slots for a doctor on a specific date
 */
export async function getAvailableSlots(
    doctorId: string,
    date: string
): Promise<string[]> {
    try {
        const client = new MultiClinicSupabaseClient(
            Deno.env.get("SUPABASE_URL") || "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
        );

        // Validate date
        if (!isValidISODate(date)) {
            return [];
        }

        // Get doctor details
        const doctor = await sheets.getDoctorById(doctorId);
        if (!doctor) {
            return [];
        }

        // Get availability schedule
        const dayOfWeek = new Date(date).toLocaleDateString("en-US", {
            weekday: "short"
        });

        const availability = await sheets.getDoctorAvailability(
            doctorId,
            dayOfWeek
        );

        if (availability.length === 0) {
            return [];
        }

        // Get occupied slots from Sheets
        const occupiedSlots = await sheets.getOccupiedSlots(doctorId, date);

        // Get available slots from Calendar
        const availableSlots = await calendar.getAvailableSlots(
            doctor.calendarId,
            date,
            30
        );

        // Filter out occupied slots
        return availableSlots.filter((slot) => !occupiedSlots.includes(slot));
    } catch (error) {
        debug("appointments", `Failed to get available slots for ${doctorId}`, {
            error: error instanceof Error ? error.message : String(error)
        });
        return [];
    }
}

/**
 * Helper function to calculate end time
 */
function getEndTime(startTime: string, durationMinutes: number): string {
    const [hours, minutes] = startTime.split(":").map(Number);
    const startDate = new Date();
    startDate.setHours(hours, minutes, 0);
    startDate.setTime(startDate.getTime() + durationMinutes * 60000);

    const endHours = String(startDate.getHours()).padStart(2, "0");
    const endMinutes = String(startDate.getMinutes()).padStart(2, "0");

    return `${endHours}:${endMinutes}`;
}
