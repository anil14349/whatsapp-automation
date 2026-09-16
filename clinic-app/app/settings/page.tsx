/**
 * Clinic settings.
 *
 * Opening hours live in clinic_operating_hours, one row per weekday, and the
 * bot reads them for every slot it offers. Editing them here is the difference
 * between a clinic owner changing Saturday hours and a clinic owner phoning us.
 */

import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";
import { DetailsForm, AddClosureForm } from "./details-form";
import { OpeningHours, Closures } from "./hours";
import type { ClinicDetails, DayHours, Holiday } from "./actions";

export default async function SettingsPage() {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        redirect("/appointments");
    }

    const result = await callAsUser("clinic-settings");

    if (result.status === 401) {
        redirect("/login");
    }

    const branding = await loadBranding();

    if (!result.ok) {
        return (
            <PortalShell session={session} branding={branding} width="max-w-4xl">
                <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {result.data?.error ?? "Could not load settings."}
                </p>
            </PortalShell>
        );
    }

    const clinic: ClinicDetails = result.data.clinic;
    const hours: DayHours[] = result.data.hours ?? [];
    const holidays: Holiday[] = result.data.holidays ?? [];

    const openDays = hours.filter((d) => !d.closed).length;

    return (
        <PortalShell session={session} branding={branding} width="max-w-4xl">
            <div className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h1 className="text-xl font-semibold">Settings</h1>
                    <p className="text-sm text-slate-500">
                        Open {openDays} day{openDays === 1 ? "" : "s"} a week
                    </p>
                </div>

                {openDays === 0 && (
                    <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Every day is marked closed, so patients cannot book anything.
                    </p>
                )}

                <DetailsForm clinic={clinic} />

                <OpeningHours hours={hours} />

                <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                    <h2 className="mb-1 text-sm font-semibold">Closures</h2>
                    <p className="mb-3 text-xs text-slate-500">
                        Holidays and one-off closed days. The bot will not offer these dates.
                    </p>

                    <AddClosureForm />
                    <Closures holidays={holidays} />
                </section>
            </div>
        </PortalShell>
    );
}
