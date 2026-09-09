import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDoctorUpcomingLeaves } from "@/lib/doctors";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireDoctorSession } from "@/lib/auth/doctorAuthorize";
import { LeavesManager } from "./LeavesManager";

export default async function DoctorLeavesPage() {
  const session = await requireDoctorSession();
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const leaves = await getDoctorUpcomingLeaves(
    supabase,
    session.doctorId,
    formatDateKey(new Date(), env.CLINIC_TIMEZONE)
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Leaves</h1>
      <p className="mt-1 text-sm text-slate-500">Your upcoming leave days.</p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <LeavesManager leaves={leaves} />
      </section>
    </div>
  );
}
