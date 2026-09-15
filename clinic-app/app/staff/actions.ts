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
            specialization: specialization || undefined
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
