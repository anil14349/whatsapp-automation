import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDoctorAvailability, getDoctorById, getDoctorUpcomingLeaves } from "@/lib/doctors";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/authorize";
import { BrandedCard } from "@/app/admin/(dashboard)/components/branded";
import { EditDoctorForm } from "./EditDoctorForm";
import { AvailabilityManager } from "./AvailabilityManager";
import { LeavesManager } from "./LeavesManager";
import { ResetDoctorPasswordForm } from "./ResetDoctorPasswordForm";

export default async function DoctorDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminRole(["ADMIN"]);
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

      <BrandedCard title="Doctor details" className="mt-6">
        <EditDoctorForm doctor={doctor} />
      </BrandedCard>

      <BrandedCard title="Doctor Portal login" className="mt-6">
        <ResetDoctorPasswordForm doctorId={doctor.id} email={doctor.email} />
      </BrandedCard>

      <BrandedCard title="Weekly availability" className="mt-6">
        <AvailabilityManager doctorId={doctor.id} sessions={availability} />
      </BrandedCard>

      <BrandedCard title="Upcoming leaves" className="mt-6">
        <LeavesManager doctorId={doctor.id} leaves={leaves} />
      </BrandedCard>
    </div>
  );
}
