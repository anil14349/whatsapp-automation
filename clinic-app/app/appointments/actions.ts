/**
 * Server actions for the receptionist day view.
 *
 * Booking runs on the server so the portal token stays in the httpOnly cookie.
 */

"use server";

import { revalidatePath } from "next/cache";
import { callAsUser } from "@/lib/portal";

export interface BookingState {
    error?: string;
    success?: string;
}

export async function loadSlots(doctorId: string, date: string): Promise<string[]> {
    const result = await callAsUser(
        `receptionists-appointments?resource=slots&doctorId=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`
    );

    return result.ok ? (result.data.slots ?? []) : [];
}

export async function bookWalkIn(
    _previous: BookingState,
    formData: FormData
): Promise<BookingState> {
    const patientName = String(formData.get("patientName") ?? "").trim();
    const patientPhone = String(formData.get("patientPhone") ?? "").trim();
    const doctorId = String(formData.get("doctorId") ?? "");
    const appointmentDate = String(formData.get("appointmentDate") ?? "");
    const appointmentTime = String(formData.get("appointmentTime") ?? "");
    const notes = String(formData.get("notes") ?? "").trim();

    if (!patientName || !patientPhone || !doctorId || !appointmentDate || !appointmentTime) {
        return { error: "Patient, phone, doctor, date and time are all required." };
    }

    // The bot identifies patients by their WhatsApp number, so a walk-in
    // booked with a malformed number would never receive reminders.
    const normalisedPhone = patientPhone.replace(/[^\d]/g, "");

    if (normalisedPhone.length < 10 || normalisedPhone.length > 15) {
        return { error: "Enter the patient's WhatsApp number including country code." };
    }

    const result = await callAsUser("receptionists-appointments", {
        method: "POST",
        body: {
            patientName,
            patientPhone: normalisedPhone,
            doctorId,
            appointmentDate,
            appointmentTime,
            notes: notes || undefined
        }
    });

    if (!result.ok) {
        if (result.status === 409) {
            return { error: "That slot was just taken. Pick another time." };
        }

        return { error: result.data?.error ?? "Could not create the appointment." };
    }

    revalidatePath("/appointments");

    return { success: `Booked ${patientName} at ${appointmentTime}.` };
}

/**
 * A doctor closing out their own appointment. Doctors have their own endpoint
 * because they may only touch appointments assigned to them.
 */
export async function updateOwnAppointmentStatus(
    id: string,
    status: "COMPLETED" | "NO_SHOW"
): Promise<BookingState> {
    const result = await callAsUser("doctors-appointments-update-status", {
        method: "PATCH",
        body: { appointmentId: id, status }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not update the appointment." };
    }

    revalidatePath("/appointments");

    return { success: `Marked ${status.toLowerCase().replace("_", " ")}.` };
}

export type AppointmentAction = "status" | "cancel" | "reschedule";

/**
 * Mark an appointment complete or no-show, cancel it, or move it.
 */
export async function updateAppointment(
    id: string,
    action: AppointmentAction,
    options: { status?: string; reason?: string; date?: string; time?: string } = {}
): Promise<BookingState> {
    const result = await callAsUser("receptionists-appointments", {
        method: "PATCH",
        body: {
            id,
            action,
            status: options.status,
            reason: options.reason,
            appointmentDate: options.date,
            appointmentTime: options.time
        }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not update the appointment." };
    }

    revalidatePath("/appointments");

    if (action === "cancel") {
        return { success: "Appointment cancelled." };
    }

    if (action === "reschedule") {
        return { success: `Moved to ${options.date} at ${options.time}.` };
    }

    return { success: `Marked ${String(options.status).toLowerCase().replace("_", " ")}.` };
}

export interface ServiceOption {
    serviceTypeId: string;
    name: string;
    requiresDoctor: boolean;
}

export async function loadServices(): Promise<ServiceOption[]> {
    const result = await callAsUser("receptionists-appointments?resource=services");

    return result.ok ? (result.data.services ?? []) : [];
}

/**
 * Correct the details of a booking. Moving it in time is the Move action.
 */
export async function editAppointment(
    id: string,
    fields: {
        patientName: string;
        patientPhone: string;
        notes: string;
        doctorId: string | null;
        serviceTypeId: string;
    }
): Promise<BookingState> {
    const patientName = fields.patientName.trim();
    const patientPhone = fields.patientPhone.replace(/\D/g, "");

    if (!patientName) {
        return { error: "Patient name cannot be empty." };
    }

    if (patientPhone.length < 10 || patientPhone.length > 15) {
        return { error: "Enter the patient's WhatsApp number including country code." };
    }

    const result = await callAsUser("receptionists-appointments", {
        method: "PATCH",
        body: {
            id,
            action: "edit",
            patientName,
            patientPhone,
            notes: fields.notes,
            doctorId: fields.doctorId,
            serviceTypeId: fields.serviceTypeId
        }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not save the changes." };
    }

    revalidatePath("/appointments");

    return { success: "Appointment updated." };
}
