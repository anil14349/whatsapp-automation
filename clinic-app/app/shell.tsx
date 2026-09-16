import Link from "next/link";
import { callAsUser, type PortalSession } from "@/lib/portal";
import { roleLabel } from "@/lib/labels";
import { brandShades, readableOn } from "@/lib/theme";
import { SignOutButton } from "./appointments/sign-out";

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
    { href: "/staff", label: "Staff", managersOnly: true },
    { href: "/services", label: "Services", managersOnly: true },
    { href: "/settings", label: "Settings", managersOnly: true }
];

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
    width = "max-w-5xl",
    children
}: {
    session: PortalSession;
    branding: Branding;
    width?: string;
    children: React.ReactNode;
}) {
    const canManage = session.role === "CLINIC_OWNER" || session.role === "ADMIN";
    const shades = brandShades(branding.brandColour);
    const year = new Date().getFullYear();

    return (
        <div style={shades as React.CSSProperties} className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
                <div className={`mx-auto flex ${width} flex-wrap items-center gap-4 px-6 py-3`}>
                    <Link href="/appointments" className="flex items-center gap-2.5">
                        <ClinicMark branding={branding} />
                        <span className="text-sm font-semibold text-slate-900">
                            {branding.name}
                        </span>
                    </Link>

                    <nav className="flex items-center gap-1">
                        {LINKS.filter((link) => canManage || !link.managersOnly).map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                            >
                                {link.label}
                            </Link>
                        ))}
                    </nav>

                    <div className="ml-auto flex items-center gap-3">
                        <span className="hidden text-sm text-slate-500 sm:inline">
                            {session.name} · {roleLabel(session.role)}
                        </span>
                        <SignOutButton />
                    </div>
                </div>
            </header>

            <main className={`mx-auto w-full ${width} flex-1 px-6 py-6`}>{children}</main>

            <footer className="border-t border-slate-200 bg-white">
                <div
                    className={`mx-auto flex ${width} flex-wrap items-center justify-between gap-2 px-6 py-4 text-xs text-slate-400`}
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
