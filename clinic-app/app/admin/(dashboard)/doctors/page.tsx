import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listDoctors } from "@/lib/doctors";
import { requireAdminRole } from "@/lib/auth/authorize";
import { NewDoctorForm } from "./NewDoctorForm";

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

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Specialization</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doctors.map((doctor) => (
              <tr key={doctor.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{doctor.name}</td>
                <td className="px-4 py-3 text-slate-500">{doctor.doctor_code}</td>
                <td className="px-4 py-3 text-slate-500">{doctor.specialization || "—"}</td>
                <td className="px-4 py-3 text-slate-500">
                  {doctor.appointment_duration_minutes} min
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      doctor.active
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                        : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                    }
                  >
                    {doctor.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/doctors/${doctor.id}`}
                    className="text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {doctors.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No doctors yet — add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
