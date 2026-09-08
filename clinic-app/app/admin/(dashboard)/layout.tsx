import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClinicNameSafe } from "@/lib/settings";
import type { AdminRole } from "@/lib/supabase/database.types";
import { LogoutButton } from "./LogoutButton";

/**
 * `roles` gates the nav *link* — the page/layout behind it and every
 * Server Action it calls enforce the same restriction independently
 * (see lib/auth/authorize.ts), so hiding a link here is a UX nicety,
 * not the actual security boundary. A RECEPTIONIST navigating straight
 * to a hidden URL still gets redirected by requireAdminRole on that
 * page, not a broken/half-rendered screen.
 */
const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/appointments", label: "Appointments", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/doctors", label: "Doctors", roles: ["ADMIN"] },
  { href: "/admin/patients", label: "Patients", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/home-collection", label: "Home Collection", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/settings", label: "Settings", roles: ["ADMIN"] }
] as const satisfies ReadonlyArray<{ href: string; label: string; roles: readonly AdminRole[] }>;

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  const visibleNavItems = NAV_ITEMS.filter((item) =>
    (item.roles as readonly AdminRole[]).includes(session.role)
  );

  const clinicName = await getClinicNameSafe(getSupabaseServerClient);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-semibold text-slate-900">{clinicName} Admin</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{session.email}</p>
          <p className="mt-0.5 text-xs font-medium text-brand-600">{session.role}</p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
