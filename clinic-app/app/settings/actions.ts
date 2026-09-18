"use server";

import { revalidatePath } from "next/cache";
import { callAsUser, uploadAsUser } from "@/lib/portal";

export interface SettingsState {
    error?: string;
    success?: string;
    logoUrl?: string | null;
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
    /** What the clinic still has to configure before it may be switched on. */
    homeCollectionBlockedBy: string[];
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

const TEXT_FIELDS = [
    "name",
    "phone",
    "email",
    "address",
    "city",
    "timezone",
    "afterHoursMessage",
    "brandColour",
    "latitude",
    "longitude",
    "homeCollectionRadiusKm"
];

/**
 * Only what the form actually carried is sent.
 *
 * Settings is several forms now, one per section, and the edge function writes
 * any key it is given. Reading a field the current form does not have yields
 * "" - which reaches the server as a real value and blanks the column. One
 * save on the Branding page would have emptied the clinic's phone and address.
 */
export async function saveDetails(
    _previous: SettingsState,
    formData: FormData
): Promise<SettingsState> {
    const body: Record<string, unknown> = {};

    for (const field of TEXT_FIELDS) {
        if (formData.has(field)) {
            body[field] = String(formData.get(field) ?? "").trim();
        }
    }

    if (formData.has("revisitWindowDays")) {
        body.revisitWindowDays = Number(formData.get("revisitWindowDays") ?? 0);
    }

    // An unticked checkbox is absent from the payload exactly like a field from
    // another section, so the section that owns it announces itself.
    if (formData.has("afterHoursSection")) {
        body.afterHoursReply = formData.get("afterHoursReply") === "on";
    }

    if (formData.has("homeCollectionSection")) {
        body.homeCollectionEnabled = formData.get("homeCollectionEnabled") === "on";
    }

    if (Object.keys(body).length === 0) {
        return { error: "Nothing to save." };
    }

    const result = await callAsUser("clinic-settings", { method: "PATCH", body });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not save." };
    }

    revalidatePath("/settings", "layout");

    return { success: "Saved." };
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Upload a logo file.
 *
 * Kept apart from saveDetails because the logo address it writes would then be
 * overwritten by whatever the details form still held in its own field.
 */
export async function uploadLogo(form: FormData): Promise<SettingsState> {
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
        return { error: "Choose an image." };
    }

    if (file.size > MAX_LOGO_BYTES) {
        return { error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.` };
    }

    if (!LOGO_TYPES.includes(file.type)) {
        return { error: "A logo must be a PNG, JPEG or WebP image." };
    }

    const outbound = new FormData();
    outbound.append("file", file);

    const result = await uploadAsUser("clinic-branding", outbound);

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not upload the logo." };
    }

    revalidatePath("/settings", "layout");
    revalidatePath("/", "layout");

    return { success: "Logo updated.", logoUrl: result.data?.logoUrl ?? null };
}

export async function removeLogo(): Promise<SettingsState> {
    const result = await callAsUser("clinic-branding", { method: "DELETE" });

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not remove the logo." };
    }

    revalidatePath("/settings", "layout");
    revalidatePath("/", "layout");

    return { success: "Logo removed.", logoUrl: null };
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

    revalidatePath("/settings", "layout");

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

    revalidatePath("/settings", "layout");

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

    revalidatePath("/settings", "layout");

    return { success: "Closure removed." };
}
