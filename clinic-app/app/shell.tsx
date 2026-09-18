import Link from "next/link";
import { callAsUser, type PortalSession } from "@/lib/portal";
import { roleLabel } from "@/lib/labels";
import { brandShades, readableOn } from "@/lib/theme";
import { PortalNav, PortalNavMenu } from "./portal-nav";
import { UserMenu } from "./user-menu";

export interface Branding {
    name: string;
    logoUrl: string | null;
    brandColour: string | null;
}

export async function loadBranding(): Promise<Branding> {
    const result = await callAsUser("clinic-branding");

    // The portal must still render if branding cannot be read; a missing logo
    // is not a reason to show nobody their appointments.
    if (!result.ok) {
        return { name: "Clinic Portal", logoUrl: null, brandColour: null };
    }

    return {
        name: result.data?.name ?? "Clinic Portal",
        logoUrl: result.data?.logoUrl ?? null,
        brandColour: result.data?.brandColour ?? null
    };
}

const LINKS = [
    { href: "/appointments", label: "Appointments", managersOnly: false },
    { href: "/summary", label: "Summary", managersOnly: true },
    { href: "/staff", label: "Staff", managersOnly: true },
    { href: "/services", label: "Services", managersOnly: true },
    { href: "/settings", label: "Settings", managersOnly: true }
];

/**
 * Header, main and footer all measure this. Nothing may override it.
 *
 * The header and footer used to take the page's own `width`, so Settings and
 * Services had a visibly narrower header than every other screen. Pinning the
 * chrome fixed that and moved the seam: those two pages still asked for a
 * narrower column, so their content sat inset from the logo above it. One
 * constant for all three is the only arrangement that cannot drift again.
 */
const CHROME_WIDTH = "max-w-6xl";

/**
 * The frame every portal page sits in.
 *
 * Header and footer were previously a bare row of links inside each page, so
 * the clinic's own name appeared nowhere and every screen had to remember to
 * include the nav.
 */
export function PortalShell({
    session,
    branding,
    children
}: {
    session: PortalSession;
    branding: Branding;
    children: React.ReactNode;
}) {
    const canManage = session.role === "CLINIC_OWNER" || session.role === "ADMIN";
    const links = LINKS.filter((link) => canManage || !link.managersOnly).map((link) => ({
        href: link.href,
        label: link.label
    }));
    const shades = brandShades(branding.brandColour);
    const year = new Date().getFullYear();

    return (
        <div style={shades as React.CSSProperties} className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
                <div className={`mx-auto flex ${CHROME_WIDTH} h-16 items-center gap-6 px-6`}>
                    <Link href="/appointments" className="flex min-w-0 items-center gap-2.5">
                        <ClinicMark branding={branding} />
                        <span className="truncate text-sm font-semibold text-slate-900">
                            {branding.name}
                        </span>
                    </Link>

                    <PortalNav links={links} />

                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <UserMenu
                            name={session.name}
                            role={roleLabel(session.role)}
                            canManage={canManage}
                        />
                        <PortalNavMenu links={links} />
                    </div>
                </div>
            </header>

            <main className={`mx-auto w-full ${CHROME_WIDTH} flex-1 px-6 py-6`}>{children}</main>

            <footer className="border-t border-slate-200 bg-white">
                <div
                    className={`mx-auto flex ${CHROME_WIDTH} flex-wrap items-center justify-between gap-2 px-6 py-4 text-xs text-slate-500`}
                >
                    <span>
                        © {year} {branding.name}
                    </span>
                    <span>Appointments and reminders over WhatsApp</span>
                </div>
            </footer>
        </div>
    );
}

/** The clinic's logo, or its initials when it has not uploaded one. */
function ClinicMark({ branding }: { branding: Branding }) {
    if (branding.logoUrl) {
        return (
            // Not next/image: the logo is a clinic-supplied URL on a host the
            // build cannot know about.
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={branding.logoUrl}
                alt=""
                className="h-8 w-8 rounded-lg object-contain"
            />
        );
    }

    const initials = branding.name
        .split(/\s+/)
        .filter((word) => /[a-z0-9]/i.test(word))
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase())
        .join("");

    return (
        <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-xs font-semibold"
            style={{ color: readableOn(branding.brandColour) }}
        >
            {initials || "C"}
        </span>
    );
}
