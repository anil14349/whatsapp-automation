/**
 * Staff management, restricted to clinic owners and platform admins.
 *
 * Runs server-side so the portal token stays in the httpOnly cookie.
 */

"use server";

import { revalidatePath } from "next/cache";
import { callAsUser, readSession } from "@/lib/portal";

export type StaffType = "doctor" | "receptionist" | "collector";

export interface StaffState {
    error?: string;
    success?: string;
    /** Shown only when the credential could not be delivered to the person. */
    credential?: { label: string; value: string };
}

async function requireManager(): Promise<string | null> {
    const session = await readSession();

    if (!session) {
        return "Not signed in.";
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        return "Only a clinic owner can manage staff.";
    }

    return null;
}

export async function createStaff(_previous: StaffState, formData: FormData): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    const type = String(formData.get("type") ?? "") as StaffType;
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").replace(/[^\d]/g, "");
    const specialization = String(formData.get("specialization") ?? "").trim();
    const qualifications = String(formData.get("qualifications") ?? "").trim();
    const photoUrl = String(formData.get("photoUrl") ?? "").trim();

    if (!name) {
        return { error: "Name is required." };
    }

    if ((type === "doctor" || type === "collector") && phone.length < 10) {
        return { error: "A WhatsApp number with country code is required." };
    }

    if (type === "receptionist" && !email) {
        return { error: "Email is required for a receptionist." };
    }

    const result = await callAsUser("staff", {
        method: "POST",
        body: {
            type,
            name,
            email: email || undefined,
            phone: phone || undefined,
            specialization: specialization || undefined,
            qualifications: qualifications || undefined,
            photoUrl: photoUrl || undefined
        }
    });

    if (!result.ok) {
        if (result.status === 409) {
            return { error: "Someone with that number or email already exists here." };
        }

        return { error: result.data?.error ?? "Could not create the staff member." };
    }

    revalidatePath("/staff");

    const pin = result.data?.temporaryPin;
    const password = result.data?.temporaryPassword;
    const channel = result.data?.deliveredBy;

    if (pin || password) {
        return {
            success: `${name} added, but the credential could not be sent.`,
            credential: {
                label: pin ? "Temporary PIN" : "Temporary password",
                value: pin ?? password
            }
        };
    }

    return { success: `${name} added. Credentials sent by ${channel ?? "message"}.` };
}

export async function setStaffActive(
    type: StaffType,
    id: string,
    isActive: boolean
): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    const result = await callAsUser("staff", {
        method: "PATCH",
        body: { type, id, isActive }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not update the staff member." };
    }

    revalidatePath("/staff");

    return { success: isActive ? "Access restored." : "Access removed." };
}

export async function resetStaffCredential(type: StaffType, id: string): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    const result = await callAsUser("staff", {
        method: "PATCH",
        body: { type, id, action: "resetCredential" }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not issue a new credential." };
    }

    const pin = result.data?.temporaryPin;
    const password = result.data?.temporaryPassword;

    if (pin || password) {
        return {
            success: "New credential issued, but it could not be sent.",
            credential: {
                label: pin ? "Temporary PIN" : "Temporary password",
                value: pin ?? password
            }
        };
    }

    return { success: `New credential sent by ${result.data?.deliveredBy ?? "message"}.` };
}

export interface StaffEdit {
    name: string;
    phone?: string;
    email?: string;
    specialization?: string;
    qualifications?: string;
    photoUrl?: string;
    maxCollectionsPerDay?: number;
}

export async function editStaff(
    type: StaffType,
    id: string,
    fields: StaffEdit
): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    if (!fields.name.trim()) {
        return { error: "Name cannot be empty." };
    }

    const result = await callAsUser("staff", {
        method: "PATCH",
        body: { type, id, action: "edit", ...fields }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not save the changes." };
    }

    revalidatePath("/staff");

    return { success: "Saved." };
}

export async function removeStaff(type: StaffType, id: string): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    const result = await callAsUser("staff", {
        method: "DELETE",
        body: { type, id }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not remove the staff member." };
    }

    revalidatePath("/staff");

    return { success: `${result.data?.name ?? "Staff member"} removed.` };
}

export interface DoctorDay {
    dayOfWeek: number;
    label: string;
    openTime: string | null;
    closeTime: string | null;
    working: boolean;
    visitOpenTime: string | null;
    visitCloseTime: string | null;
    visiting: boolean;
}

export interface DoctorLeave {
    id: string;
    leave_start_date: string;
    leave_end_date: string;
    reason: string | null;
}

export interface DoctorSchedule {
    hours: DoctorDay[];
    leaves: DoctorLeave[];
    error?: string;
}

export async function loadDoctorSchedule(doctorId: string): Promise<DoctorSchedule> {
    const result = await callAsUser(`doctor-schedule?doctorId=${encodeURIComponent(doctorId)}`);

    if (!result.ok) {
        return { hours: [], leaves: [], error: result.data?.error ?? "Could not load the schedule." };
    }

    return { hours: result.data.hours ?? [], leaves: result.data.leaves ?? [] };
}

export async function saveDoctorHours(
    doctorId: string,
    dayOfWeek: number,
    openTime: string,
    closeTime: string,
    working: boolean,
    /** Hours spent visiting patients at home, which are kept separately. */
    visiting = false
): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    const result = await callAsUser("doctor-schedule", {
        method: "PATCH",
        body: visiting
            ? { doctorId, dayOfWeek, openTime, closeTime, working, visiting: true }
            : { doctorId, dayOfWeek, openTime, closeTime, working }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not save the hours." };
    }

    revalidatePath("/staff");

    if (visiting) {
        return { success: "Visiting hours saved." };
    }

    // The clinic's own hours win, and the endpoint says so when they clash.
    return { success: result.data?.note ?? "Hours saved." };
}

export async function addDoctorLeave(
    doctorId: string,
    startDate: string,
    endDate: string,
    reason: string
): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    if (!startDate) {
        return { error: "Pick the first day." };
    }

    const result = await callAsUser("doctor-schedule", {
        method: "POST",
        body: { doctorId, startDate, endDate: endDate || startDate, reason }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not record the leave." };
    }

    revalidatePath("/staff");

    const booked = result.data?.existingAppointments ?? 0;

    return {
        success: booked
            ? `Leave recorded. ${booked} appointment${booked === 1 ? " is" : "s are"} already booked in that period and ${booked === 1 ? "has" : "have"} not been cancelled.`
            : "Leave recorded."
    };
}

export async function cancelDoctorLeave(
    doctorId: string,
    leaveId: string
): Promise<StaffState> {
    const denied = await requireManager();
    if (denied) return { error: denied };

    const result = await callAsUser("doctor-schedule", {
        method: "DELETE",
        body: { doctorId, leaveId }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not cancel the leave." };
    }

    revalidatePath("/staff");

    return { success: "Leave cancelled." };
}
