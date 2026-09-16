/**
 * What this clinic offers.
 *
 * Shows the whole catalogue rather than only what is switched on, so a service
 * the clinic has never used can be turned on without touching the database.
 */

import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";
import { ServiceManager } from "./service-manager";
import { AddServiceForm } from "./add-service-form";
import type { ServiceRow } from "./actions";

export default async function ServicesPage() {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        redirect("/appointments");
    }

    const result = await callAsUser("services");

    if (result.status === 401) {
        redirect("/login");
    }

    const services: ServiceRow[] = result.ok ? (result.data.services ?? []) : [];
    const offered = services.filter((s) => s.isEnabled).length;
    const branding = await loadBranding();

    return (
        <PortalShell session={session} branding={branding} width="max-w-4xl">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-xl font-semibold">Services</h1>
                <p className="text-sm text-slate-500">
                    {offered} of {services.length} offered to patients
                </p>
            </div>

            {!result.ok && (
                <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {result.data?.error ?? "Could not load services."}
                </p>
            )}

            {offered === 0 && result.ok && (
                <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    No services are switched on, so patients cannot book anything.
                </p>
            )}

            <div className="mb-4">
                <AddServiceForm />
            </div>

            <ServiceManager services={services} />
        </PortalShell>
    );
}
