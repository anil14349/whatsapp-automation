import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getBooleanSetting, getClinicNameSafe } from "@/lib/settings";
import { getClinicBranding } from "@/lib/branding/clinic";
import { BrandingProvider } from "@/lib/branding/context";
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
  { href: "/admin/analytics", label: "Analytics", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/doctors", label: "Doctors", roles: ["ADMIN"] },
  { href: "/admin/patients", label: "Patients", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/home-collection", label: "Home Collection", roles: ["ADMIN", "RECEPTIONIST"] },
  { href: "/admin/settings", label: "Settings", roles: ["ADMIN"] },
  { href: "/admin/admin-users", label: "Admin Users", roles: ["ADMIN"] }
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

  const supabase = getSupabaseServerClient();

  const [clinicName, homeCollectionEnabled, branding] = await Promise.all([
    getClinicNameSafe(getSupabaseServerClient),
    getBooleanSetting(supabase, "ENABLE_HOME_COLLECTION", true).catch(() => true),
    getClinicBranding(supabase, session.clinic_id).catch(() => null)
  ]);

  // The /admin/home-collection *page* stays reachable directly even when
  // this is off (a hospital that turned diagnostics off after having
  // some historical requests can still review them) — only the sidebar
  // link disappears, matching how the WhatsApp menu entry disappears
  // for patients (see lib/whatsapp/patientFlow.ts's sendMoreMenu).
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!(item.roles as readonly AdminRole[]).includes(session.role)) {
      return false;
    }

    if (item.href === "/admin/home-collection" && !homeCollectionEnabled) {
      return false;
    }

    return true;
  });

  if (!branding) {
    // Fallback if branding fails to load
    return <DashboardLayoutContent clinicName={clinicName} session={session} visibleNavItems={visibleNavItems} />;
  }

  return (
    <BrandingProvider branding={branding}>
      <DashboardLayoutContent clinicName={clinicName} session={session} visibleNavItems={visibleNavItems} branding={branding} />
    </BrandingProvider>
  );
}

interface DashboardLayoutContentProps {
  clinicName: string;
  session: any;
  visibleNavItems: any[];
  branding?: any;
}

function DashboardLayoutContent({
  clinicName,
  session,
  visibleNavItems,
  branding
}: DashboardLayoutContentProps) {
  const sidebarBgColor = branding?.primaryColor || "#0066cc";
  const textColor = branding && isColorDark(branding.primaryColor) ? "#ffffff" : "#000000";
  const hoverBgColor = branding ? `${branding.primaryColor}10` : "#f1f5f9"; // 6% opacity

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        className="flex w-60 flex-col border-r border-slate-200"
        style={{ backgroundColor: sidebarBgColor }}
      >
        {/* Logo / Header */}
        <div
          className="border-b border-opacity-20 px-5 py-4"
          style={{ borderColor: branding ? `${branding.primaryColor}40` : "#e2e8f0" }}
        >
          {branding?.logoUrl && (
            <div className="mb-3 flex items-center justify-center h-10">
              <img
                src={branding.logoUrl}
                alt="Logo"
                className="h-full object-contain"
              />
            </div>
          )}
          <p
            className="text-sm font-semibold"
            style={{ color: textColor, opacity: 0.9 }}
          >
            {clinicName} Admin
          </p>
          <p
            className="mt-0.5 truncate text-xs"
            style={{ color: textColor, opacity: 0.7 }}
          >
            {session.email}
          </p>
          <p
            className="mt-0.5 text-xs font-medium"
            style={{ color: branding?.accentColor || "#ff6600" }}
          >
            {session.role}
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {visibleNavItems.map((item: any) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium transition-colors"
              style={{
                color: textColor,
                opacity: 0.8,
                backgroundColor: "transparent"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.backgroundColor = hoverBgColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "0.8";
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Logout Button */}
        <div
          className="border-t border-opacity-20 p-3"
          style={{ borderColor: branding ? `${branding.primaryColor}40` : "#e2e8f0" }}
        >
          <LogoutButton textColor={textColor} hoverBgColor={hoverBgColor} />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}

/**
 * Check if color is dark (for text contrast)
 */
function isColorDark(hexColor: string): boolean {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}
