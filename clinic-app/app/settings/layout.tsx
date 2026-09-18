import { redirect } from "next/navigation";
import { readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";
import { SettingsNav } from "./settings-nav";

/**
 * The frame every settings section sits in.
 *
 * Settings used to be one page holding the clinic's name, its hours, its
 * closures, its home-collection area and its out-of-hours reply, in one scroll.
 * The sections are routes now, so each one is linkable and the page stops
 * growing every time a setting is added.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        redirect("/appointments");
    }

    const branding = await loadBranding();

    return (
        <PortalShell session={session} branding={branding}>
            <h1 className="mb-4 text-xl font-semibold">Settings</h1>

            <div className="flex">
                <SettingsNav />
                {/* Separates the navigation from the content without boxing the
                    navigation in: the cards carry the borders here. */}
                <div aria-hidden="true" className="w-px shrink-0 self-stretch bg-slate-200" />
                <div className="min-w-0 flex-1 space-y-4 pl-6">{children}</div>
            </div>
        </PortalShell>
    );
}
