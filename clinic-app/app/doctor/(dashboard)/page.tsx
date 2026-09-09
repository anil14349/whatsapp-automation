import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDoctorConfirmedAppointments } from "@/lib/appointments";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireDoctorSession } from "@/lib/auth/doctorAuthorize";
import { AppointmentRowActions } from "./AppointmentRowActions";

export default async function DoctorSchedulePage() {
  const session = await requireDoctorSession();
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();
  const today = formatDateKey(new Date(), env.CLINIC_TIMEZONE);

  const appointments = await getDoctorConfirmedAppointments(supabase, session.doctorId, {
    fromDate: today
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">My Schedule</h1>
      <p className="mt-1 text-sm text-slate-500">Your upcoming confirmed appointments.</p>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-500">Date</th>
              <th className="px-4 py-2 text-left font-medium text-slate-500">Time</th>
              <th className="px-4 py-2 text-left font-medium text-slate-500">Patient</th>
              <th className="px-4 py-2 text-left font-medium text-slate-500">Phone</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {appointments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No upcoming appointments.
                </td>
              </tr>
            ) : (
              appointments.map((appointment) => (
                <tr key={appointment.id}>
                  <td className="px-4 py-2 text-slate-700">{appointment.appointment_date}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {appointment.appointment_time.slice(0, 5)}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{appointment.patient_name}</td>
                  <td className="px-4 py-2 text-slate-700">{appointment.patient_phone}</td>
                  <td className="px-4 py-2 text-right">
                    <AppointmentRowActions appointmentId={appointment.id} status={appointment.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
