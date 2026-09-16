import Link from "next/link";
import type { PortalSession } from "@/lib/portal";
import { SignOutButton } from "./appointments/sign-out";

/** Staff management is only shown to those who can actually use it. */
export function PortalNav({ session }: { session: PortalSession }) {
    const canManageStaff = session.role === "CLINIC_OWNER" || session.role === "ADMIN";

    return (
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <nav className="flex items-center gap-1">
                <Link
                    href="/appointments"
                    className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white hover:text-slate-900"
                >
                    Appointments
                </Link>
                {canManageStaff && (
                    <Link
                        href="/staff"
                        className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white hover:text-slate-900"
                    >
                        Staff
                    </Link>
                )}
                {canManageStaff && (
                    <Link
                        href="/services"
                        className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white hover:text-slate-900"
                    >
                        Services
                    </Link>
                )}
                {canManageStaff && (
                    <Link
                        href="/settings"
                        className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white hover:text-slate-900"
                    >
                        Settings
                    </Link>
                )}
            </nav>

            <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">
                    {session.name} · {session.role.toLowerCase().replace("_", " ")}
                </span>
                <SignOutButton />
            </div>
        </header>
    );
}
