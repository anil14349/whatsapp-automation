/**
 * Server actions for the receptionist day view.
 *
 * Booking runs on the server so the portal token stays in the httpOnly cookie.
 */

"use server";

import { revalidatePath } from "next/cache";
import { callAsUser, uploadAsUser } from "@/lib/portal";

export interface BookingState {
    error?: string;
    success?: string;
    // The slot that was taken, so the form can drop it from the list without
    // reading the time back out of the sentence above.
    bookedTime?: string;
}

export interface SentDocument {
    id: string;
    kind: string;
    file_name: string;
    status: string;
    error_message: string | null;
    sent_at: string | null;
    created_at: string;
}

export async function loadDocuments(appointmentId: string): Promise<SentDocument[]> {
    const result = await callAsUser(
        `patient-documents?appointmentId=${encodeURIComponent(appointmentId)}`
    );

    return result.ok ? (result.data.documents ?? []) : [];
}

/**
 * Send a report or prescription to the patient.
 *
 * The file is forwarded rather than read here: the portal has no service key,
 * and putting one in it would give the browser process a way into every table.
 */
export async function sendDocument(
    _previous: BookingState,
    formData: FormData
): Promise<BookingState> {
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
        return { error: "Choose a file first." };
    }

    const result = await uploadAsUser("patient-documents", formData);

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not send the document." };
    }

    revalidatePath("/appointments");

    // Stored but refused by Meta is not success, and the desk has to know
    // because the patient is waiting for the result.
    if (result.data?.status === "FAILED") {
        return { error: result.data.error ?? "Saved, but WhatsApp would not accept it." };
    }

    // WhatsApp confirms delivery afterwards, so this cannot promise it arrived.
    return { success: "Sent to WhatsApp. The list below shows when it arrives." };
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

    return { success: `Booked ${patientName} at ${appointmentTime}.`, bookedTime: appointmentTime };
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

/**
 * Tell everyone still waiting for a doctor that they are running late.
 *
 * The booked times are left alone; moving them would free slots that are not
 * really free and cascade through the rest of the day.
 */
export async function announceDelay(
    doctorId: string,
    minutes: number
): Promise<BookingState> {
    const result = await callAsUser("receptionists-appointments", {
        method: "POST",
        body: { action: "delay", doctorId, minutes }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not send the update." };
    }

    revalidatePath("/appointments");

    const { notified = 0, failed = 0 } = result.data ?? {};

    if (notified === 0 && failed === 0) {
        return { success: "Nobody is still waiting, so no messages were sent." };
    }

    // "Told" claimed more than we know: WhatsApp only accepts the message here
    // and reports failures minutes later, where Summary picks them up.
    return {
        success: failed
            ? `Sent to ${notified} waiting patient${notified === 1 ? "" : "s"}. ${failed} could not be reached.`
            : `Sent to ${notified} waiting patient${notified === 1 ? "" : "s"}. Any that do not arrive are counted on Summary.`
    };
}

export async function loadServices(): Promise<ServiceOption[]> {
    const result = await callAsUser("receptionists-appointments?resource=services");

    return result.ok ? (result.data.services ?? []) : [];
}

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
