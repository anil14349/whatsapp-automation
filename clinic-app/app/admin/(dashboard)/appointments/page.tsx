import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listDoctors } from "@/lib/doctors";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/authorize";
import type { AppointmentStatus } from "@/lib/supabase/database.types";
import { AppointmentRowActions } from "./AppointmentRowActions";
import { NewAppointmentForm } from "./NewAppointmentForm";
import { BroadcastForm } from "./BroadcastForm";

const VALID_STATUSES: readonly AppointmentStatus[] = [
  "Confirmed",
  "Completed",
  "No-Show",
  "Cancelled"
];

function parseStatusFilter(value: string | undefined): AppointmentStatus | null {
  return (VALID_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as AppointmentStatus)
    : null;
}

/**
 * A Server Action's maxDuration is set on the route segment that
 * renders the form invoking it, not in the "use server" actions file
 * itself (that file may only export async functions). This page renders
 * BroadcastForm, whose action (broadcastToDoctorPatientsAction, in
 * ./actions.ts) awaits sendDoctorBroadcast's full send loop
 * synchronously so the admin UI can show the final sent/error counts —
 * unlike the WhatsApp Doctor Portal's copy of that call
 * (lib/whatsapp/doctorFlow.ts), which defers it into an after()
 * callback instead. Raise this if a clinic's confirmed-appointment list
 * doesn't finish broadcasting in time (see CONFIGURATION.md's "Doctor
 * broadcast timeouts" section), bounded by whatever your hosting plan
 * allows.
 */
export const maxDuration = 60;

export default async function AppointmentsPage({
  searchParams
}: {
  searchParams: Promise<{ doctorId?: string; date?: string; status?: string }>;
}) {
  await requireAdminRole(["ADMIN", "RECEPTIONIST"]);
  const filters = await searchParams;
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const doctors = await listDoctors(supabase);

  let query = supabase
    .from("appointments")
    .select("*")
    .order("appointment_date", { ascending: false })
    .order("appointment_time")
    .limit(200);

  if (filters.doctorId) {
    query = query.eq("doctor_id", filters.doctorId);
  }

  if (filters.date) {
    query = query.eq("appointment_date", filters.date);
  } else {
    // Default view: today onward, so the list isn't dominated by old
    // history — an explicit date filter (including a past date) opts out.
    query = query.gte("appointment_date", formatDateKey(new Date(), env.CLINIC_TIMEZONE));
  }

  const statusFilter = parseStatusFilter(filters.status);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data: appointments, error } = await query;

  if (error) {
    throw new Error(`Failed to load appointments: ${error.message}`);
  }

  const doctorsById = new Map(doctors.map((d) => [d.id, d]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Appointments</h1>
      <p className="mt-1 text-sm text-slate-500">
        Showing upcoming appointments unless a specific date is chosen.
      </p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">New Appointment (walk-in)</h2>
        <p className="mt-1 text-xs text-slate-500">
          For a patient who came to the hospital directly rather than booking over WhatsApp.
        </p>
        <div className="mt-4">
          <NewAppointmentForm doctors={doctors.filter((d) => d.active)} />
        </div>
      </section>

      <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Doctor</label>
          <select
            name="doctorId"
            defaultValue={filters.doctorId ?? ""}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Date</label>
          <input
            type="date"
            name="date"
            defaultValue={filters.date ?? ""}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Status</label>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Completed">Completed</option>
            <option value="No-Show">No-Show</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Doctor</th>
              <th className="px-4 py-3">Patient</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {appointments.map((appt) => (
              <tr key={appt.id}>
                <td className="px-4 py-3 text-slate-700">{appt.appointment_date}</td>
                <td className="px-4 py-3 text-slate-700">{appt.appointment_time.slice(0, 5)}</td>
                <td className="px-4 py-3 text-slate-700">
                  {doctorsById.get(appt.doctor_id)?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-700">{appt.patient_name}</td>
                <td className="px-4 py-3 text-slate-500">{appt.patient_phone}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={appt.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <AppointmentRowActions appointmentId={appt.id} doctorId={appt.doctor_id} status={appt.status} />
                </td>
              </tr>
            ))}
            {appointments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No appointments match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filters.doctorId && filters.date && (
        <BroadcastForm doctorId={filters.doctorId} date={filters.date} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Confirmed: "bg-blue-100 text-blue-700",
    Completed: "bg-green-100 text-green-700",
    "No-Show": "bg-amber-100 text-amber-700",
    Cancelled: "bg-slate-100 text-slate-500"
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}
