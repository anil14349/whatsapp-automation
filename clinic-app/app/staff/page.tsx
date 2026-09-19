import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";
import { StaffManager, type StaffMember } from "./staff-manager";
import type { StaffType } from "./actions";

async function load(type: StaffType): Promise<StaffMember[]> {
    const result = await callAsUser(`staff?type=${type}`);

    if (!result.ok) {
        return [];
    }

    // The table is snake_case and the component is not.
    return (result.data.staff ?? []).map((row: any) => ({
        ...row,
        photoUrl: row.photo_url ?? null,
        takesOnlineAppointments: row.takes_online_appointments !== false
    }));
}

export default async function StaffPage() {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        redirect("/appointments");
    }

    const [doctor, receptionist, collector, branding] = await Promise.all([
        load("doctor"),
        load("receptionist"),
        load("collector"),
        loadBranding()
    ]);

    return (
        <PortalShell session={session} branding={branding}>
            <h1 className="mb-1 text-xl font-semibold">Staff</h1>
            <p className="mb-6 text-sm text-slate-500">
                Adding someone here is what lets them use the WhatsApp bot and the portal.
            </p>

            <StaffManager staff={{ doctor, receptionist, collector }} />
        </PortalShell>
    );
}
