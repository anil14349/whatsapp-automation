import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDoctorAvailability } from "@/lib/doctors";
import { requireDoctorSession } from "@/lib/auth/doctorAuthorize";
import { AvailabilityManager } from "./AvailabilityManager";

export default async function DoctorAvailabilityPage() {
  const session = await requireDoctorSession();
  const supabase = getSupabaseServerClient();

  const availability = await getDoctorAvailability(supabase, session.doctorId);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Availability</h1>
      <p className="mt-1 text-sm text-slate-500">Your weekly recurring hours.</p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <AvailabilityManager sessions={availability} />
      </section>
    </div>
  );
}
