import { redirect } from "next/navigation";
import { callAsUser } from "@/lib/portal";
import type { ClinicDetails, DayHours, Holiday } from "./actions";

export interface SettingsData {
    clinic: ClinicDetails;
    hours: DayHours[];
    holidays: Holiday[];
}

/** Every section reads the same endpoint; only the part it shows differs. */
export async function loadSettings(): Promise<SettingsData | { error: string }> {
    const result = await callAsUser("clinic-settings");

    if (result.status === 401) {
        redirect("/login");
    }

    if (!result.ok) {
        return { error: result.data?.error ?? "Could not load settings." };
    }

    return {
        clinic: result.data.clinic,
        hours: result.data.hours ?? [],
        holidays: result.data.holidays ?? []
    };
}

export function SettingsError({ message }: { message: string }) {
    return (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {message}
        </p>
    );
}
