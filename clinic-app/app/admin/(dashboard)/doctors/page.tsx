import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listDoctors } from "@/lib/doctors";
import { requireAdminRole } from "@/lib/auth/authorize";
import { NewDoctorForm } from "./NewDoctorForm";
import {
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell,
  BrandedBadge,
  BrandedLink
} from "@/app/admin/(dashboard)/components/branded";

export default async function DoctorsPage() {
  await requireAdminRole(["ADMIN"]);
  const supabase = getSupabaseServerClient();
  const doctors = await listDoctors(supabase);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Doctors</h1>
      <p className="mt-1 text-sm text-slate-500">
        Manage doctor records, availability, and leaves.
      </p>

      <div className="mt-6">
        <BrandedTable>
          <BrandedTableHeader>
            <BrandedTableCell>Name</BrandedTableCell>
            <BrandedTableCell>Code</BrandedTableCell>
            <BrandedTableCell>Specialization</BrandedTableCell>
            <BrandedTableCell>Duration</BrandedTableCell>
            <BrandedTableCell>Status</BrandedTableCell>
            <BrandedTableCell />
          </BrandedTableHeader>
          <tbody>
            {doctors.map((doctor) => (
              <BrandedTableRow key={doctor.id}>
                <BrandedTableCell className="font-medium">{doctor.name}</BrandedTableCell>
                <BrandedTableCell>{doctor.doctor_code}</BrandedTableCell>
                <BrandedTableCell>{doctor.specialization || "—"}</BrandedTableCell>
                <BrandedTableCell>
                  {doctor.appointment_duration_minutes} min
                </BrandedTableCell>
                <BrandedTableCell>
                  <BrandedBadge variant={doctor.active ? "success" : "default"} size="sm">
                    {doctor.active ? "Active" : "Inactive"}
                  </BrandedBadge>
                </BrandedTableCell>
                <BrandedTableCell className="text-right">
                  <BrandedLink href={`/admin/doctors/${doctor.id}`}>
                    Manage
                  </BrandedLink>
                </BrandedTableCell>
              </BrandedTableRow>
            ))}
            {doctors.length === 0 && (
              <BrandedTableRow>
                <BrandedTableCell colSpan={6} className="text-center py-6">
                  No doctors yet — add one below.
                </BrandedTableCell>
              </BrandedTableRow>
            )}
          </tbody>
        </BrandedTable>
      </div>

      <div className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Add a doctor</h2>
        <div className="mt-4">
          <NewDoctorForm />
        </div>
      </div>
    </div>
  );
}
