"use server";

import { revalidatePath } from "next/cache";
import { callAsUser } from "@/lib/portal";

export interface ServiceState {
    error?: string;
    success?: string;
}

export interface ServiceRow {
    serviceTypeId: string;
    code: string;
    name: string;
    category: string;
    isOwn: boolean;
    configured: boolean;
    isEnabled: boolean;
    offeredAtClinic: boolean;
    offeredAtHome: boolean;
    requiresDoctor: boolean;
    clinicPrice: number | null;
    homePrice: number | null;
    durationMinutes: number | null;
    concurrentCapacity: number;
    displayOrder: number;
    defaults: {
        clinicPrice: number | null;
        homePrice: number | null;
        durationMinutes: number | null;
    };
}

export async function createService(
    _previous: ServiceState,
    formData: FormData
): Promise<ServiceState> {
    const name = String(formData.get("name") ?? "").trim();
    const category = String(formData.get("category") ?? "OTHER");
    const durationMinutes = Number(formData.get("durationMinutes") ?? 30);
    const rawPrice = String(formData.get("clinicPrice") ?? "").trim();

    if (!name) {
        return { error: "Give the service a name." };
    }

    const result = await callAsUser("services", {
        method: "POST",
        body: {
            name,
            category,
            durationMinutes,
            clinicPrice: rawPrice === "" ? null : Number(rawPrice)
        }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not add the service." };
    }

    revalidatePath("/services");

    return { success: `Added ${name}. Switch it on when you are ready to offer it.` };
}

export async function renameService(
    serviceTypeId: string,
    name: string
): Promise<ServiceState> {
    const result = await callAsUser("services", {
        method: "PATCH",
        body: { serviceTypeId, name }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not rename the service." };
    }

    revalidatePath("/services");

    return { success: `Renamed to ${name}.` };
}

export async function removeService(serviceTypeId: string): Promise<ServiceState> {
    const result = await callAsUser("services", {
        method: "DELETE",
        body: { serviceTypeId }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not remove the service." };
    }

    revalidatePath("/services");

    return { success: "Removed." };
}

export async function updateService(
    serviceTypeId: string,
    changes: Partial<{
        isEnabled: boolean;
        offeredAtClinic: boolean;
        offeredAtHome: boolean;
        requiresDoctor: boolean;
        clinicPrice: number | null;
        homePrice: number | null;
        durationMinutes: number | null;
        concurrentCapacity: number;
    }>
): Promise<ServiceState> {
    const result = await callAsUser("services", {
        method: "PATCH",
        body: { serviceTypeId, ...changes }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not update the service." };
    }

    revalidatePath("/services");

    return { success: "Saved." };
}
