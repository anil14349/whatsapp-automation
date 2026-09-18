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

    const [result, branding] = await Promise.all([callAsUser("services"), loadBranding()]);

    if (result.status === 401) {
        redirect("/login");
    }

    const services: ServiceRow[] = result.ok ? (result.data.services ?? []) : [];
    const offered = services.filter((s) => s.isEnabled).length;

    return (
        <PortalShell session={session} branding={branding}>
            <AddServiceForm
                title="Services"
                summary={`${offered} of ${services.length} offered to patients`}
            />

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

            <ServiceManager services={services} />
        </PortalShell>
    );
}
