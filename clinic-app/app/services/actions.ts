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
