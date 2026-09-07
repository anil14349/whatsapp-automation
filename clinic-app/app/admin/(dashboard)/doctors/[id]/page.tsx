import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDoctorAvailability, getDoctorById, getDoctorUpcomingLeaves } from "@/lib/doctors";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { EditDoctorForm } from "./EditDoctorForm";
import { AvailabilityManager } from "./AvailabilityManager";
import { LeavesManager } from "./LeavesManager";

export default async function DoctorDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const doctor = await getDoctorById(supabase, id);

  if (!doctor) {
    notFound();
  }

  const [availability, leaves] = await Promise.all([
    getDoctorAvailability(supabase, doctor.id),
    getDoctorUpcomingLeaves(supabase, doctor.id, formatDateKey(new Date(), env.CLINIC_TIMEZONE))
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">{doctor.name}</h1>
      <p className="mt-1 text-sm text-slate-500">Doctor code: {doctor.doctor_code}</p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Doctor details</h2>
        <div className="mt-4">
          <EditDoctorForm doctor={doctor} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Weekly availability</h2>
        <div className="mt-4">
          <AvailabilityManager doctorId={doctor.id} sessions={availability} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Upcoming leaves</h2>
        <div className="mt-4">
          <LeavesManager doctorId={doctor.id} leaves={leaves} />
        </div>
      </section>
    </div>
  );
}
