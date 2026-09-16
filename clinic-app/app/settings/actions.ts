"use server";

import { revalidatePath } from "next/cache";
import { callAsUser } from "@/lib/portal";

export interface SettingsState {
    error?: string;
    success?: string;
}

export interface ClinicDetails {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    timezone: string;
    afterHoursMessage: string | null;
    afterHoursReply: boolean;
    revisitWindowDays: number;
    logoUrl: string | null;
    brandColour: string | null;
    latitude: number | null;
    longitude: number | null;
    homeCollectionRadiusKm: number | null;
    homeCollectionEnabled: boolean;
}

export interface DayHours {
    dayOfWeek: number;
    label: string;
    openTime: string | null;
    closeTime: string | null;
    closed: boolean;
}

export interface Holiday {
    id: string;
    holiday_date: string;
    holiday_name: string;
}

export async function saveDetails(
    _previous: SettingsState,
    formData: FormData
): Promise<SettingsState> {
    const body: Record<string, unknown> = {
        name: String(formData.get("name") ?? "").trim(),
        phone: String(formData.get("phone") ?? "").trim(),
        email: String(formData.get("email") ?? "").trim(),
        address: String(formData.get("address") ?? "").trim(),
        city: String(formData.get("city") ?? "").trim(),
        timezone: String(formData.get("timezone") ?? "").trim(),
        afterHoursMessage: String(formData.get("afterHoursMessage") ?? "").trim(),
        afterHoursReply: formData.get("afterHoursReply") === "on",
        revisitWindowDays: Number(formData.get("revisitWindowDays") ?? 0),
        logoUrl: String(formData.get("logoUrl") ?? "").trim(),
        brandColour: String(formData.get("brandColour") ?? "").trim(),
        latitude: String(formData.get("latitude") ?? "").trim(),
        longitude: String(formData.get("longitude") ?? "").trim(),
        homeCollectionRadiusKm: String(formData.get("homeCollectionRadiusKm") ?? "").trim()
    };

    const result = await callAsUser("clinic-settings", { method: "PATCH", body });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not save." };
    }

    revalidatePath("/settings");

    return { success: "Saved." };
}

export async function saveDay(
    dayOfWeek: number,
    openTime: string,
    closeTime: string,
    closed: boolean
): Promise<SettingsState> {
    const result = await callAsUser("clinic-settings", {
        method: "PATCH",
        body: { dayOfWeek, openTime, closeTime, closed }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not save the hours." };
    }

    revalidatePath("/settings");

    return { success: "Hours saved." };
}

export async function addClosure(
    _previous: SettingsState,
    formData: FormData
): Promise<SettingsState> {
    const date = String(formData.get("date") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    if (!date) {
        return { error: "Pick a date." };
    }

    const result = await callAsUser("clinic-settings", {
        method: "POST",
        body: { date, name }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not add the closure." };
    }

    revalidatePath("/settings");

    const booked = result.data?.existingAppointments ?? 0;

    // Closing a day does not cancel what is already booked, and finding that
    // out on the morning would be worse than being told now.
    return {
        success: booked
            ? `Closed on ${date}. ${booked} appointment${booked === 1 ? " is" : "s are"} already booked that day and ${booked === 1 ? "has" : "have"} not been cancelled.`
            : `Closed on ${date}.`
    };
}

export async function removeClosure(holidayId: string): Promise<SettingsState> {
    const result = await callAsUser("clinic-settings", {
        method: "DELETE",
        body: { holidayId }
    });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not remove the closure." };
    }

    revalidatePath("/settings");

    return { success: "Closure removed." };
}
