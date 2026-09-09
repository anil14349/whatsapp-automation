import { redirect } from "next/navigation";
import Link from "next/link";
import { getDoctorSession } from "@/lib/auth/doctorSession";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClinicNameSafe } from "@/lib/settings";
import { LogoutButton } from "./LogoutButton";

const NAV_ITEMS = [
  { href: "/doctor", label: "My Schedule" },
  { href: "/doctor/availability", label: "Availability" },
  { href: "/doctor/leaves", label: "Leaves" }
] as const;

export default async function DoctorDashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = await getDoctorSession();

  if (!session) {
    redirect("/doctor/login");
  }

  const clinicName = await getClinicNameSafe(getSupabaseServerClient);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-semibold text-slate-900">{clinicName} Doctor Portal</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{session.email}</p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {NAV_ITEMS.map((item) => (
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
