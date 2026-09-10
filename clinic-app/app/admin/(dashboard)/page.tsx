import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listDoctors } from "@/lib/doctors";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/authorize";
import { BrandedCard } from "@/app/admin/(dashboard)/components/branded";

async function getDashboardStats() {
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();
  const today = formatDateKey(new Date(), env.CLINIC_TIMEZONE);

  const [doctors, { count: todayCount }, { count: confirmedCount }] = await Promise.all([
    listDoctors(supabase, { activeOnly: true }),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("appointment_date", today)
      .eq("status", "Confirmed"),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "Confirmed")
      .gte("appointment_date", today)
  ]);

  return {
    activeDoctors: doctors.length,
    todayAppointments: todayCount ?? 0,
    upcomingAppointments: confirmedCount ?? 0
  };
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <BrandedCard>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </BrandedCard>
  );
}

export default async function DashboardPage() {
  await requireAdminRole(["ADMIN", "RECEPTIONIST"]);
  const stats = await getDashboardStats();

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Overview of today&apos;s clinic activity.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Today's appointments" value={stats.todayAppointments} />
        <StatCard label="Upcoming appointments" value={stats.upcomingAppointments} />
        <StatCard label="Active doctors" value={stats.activeDoctors} />
      </div>
    </div>
  );
}
