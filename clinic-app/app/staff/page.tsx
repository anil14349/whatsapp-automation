import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalNav } from "@/app/nav";
import { StaffManager, type StaffMember } from "./staff-manager";
import type { StaffType } from "./actions";

async function load(type: StaffType): Promise<StaffMember[]> {
    const result = await callAsUser(`staff?type=${type}`);
    return result.ok ? (result.data.staff ?? []) : [];
}

export default async function StaffPage() {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        redirect("/appointments");
    }

    const [doctor, receptionist, collector] = await Promise.all([
        load("doctor"),
        load("receptionist"),
        load("collector")
    ]);

    return (
        <main className="mx-auto max-w-5xl p-6">
            <PortalNav session={session} />

            <h1 className="mb-1 text-xl font-semibold">Staff</h1>
            <p className="mb-6 text-sm text-slate-500">
                Adding someone here is what lets them use the WhatsApp bot and the portal.
            </p>

            <StaffManager staff={{ doctor, receptionist, collector }} />
        </main>
    );
}
