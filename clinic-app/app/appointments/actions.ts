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
