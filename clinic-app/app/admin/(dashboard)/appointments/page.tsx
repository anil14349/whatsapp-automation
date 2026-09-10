import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listDoctors } from "@/lib/doctors";
import { formatDateKey } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/authorize";
import type { AppointmentStatus } from "@/lib/supabase/database.types";
import { AppointmentRowActions } from "./AppointmentRowActions";
import { NewAppointmentForm } from "./NewAppointmentForm";
import { BroadcastForm } from "./BroadcastForm";
import {
  BrandedButton,
  BrandedSelect,
  BrandedInput,
  BrandedBadge,
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell
} from "@/app/admin/(dashboard)/components/branded";

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
  const activeDoctors = doctors.filter((d) => d.active);

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

      <form className="mt-6 flex flex-wrap items-end gap-4" method="get">
        <div className="flex-1 min-w-fit">
          <BrandedSelect
            label="Doctor"
            name="doctorId"
            defaultValue={filters.doctorId ?? ""}
            options={[
              { value: "", label: "All doctors" },
              ...doctors.map((doctor) => ({ value: doctor.id, label: doctor.name }))
            ]}
          />
        </div>

        <div className="flex-1 min-w-fit">
          <BrandedInput
            label="Date"
            type="date"
            name="date"
            defaultValue={filters.date ?? ""}
          />
        </div>

        <div className="flex-1 min-w-fit">
          <BrandedSelect
            label="Status"
            name="status"
            defaultValue={filters.status ?? ""}
            options={[
              { value: "", label: "All statuses" },
              { value: "Confirmed", label: "Confirmed" },
              { value: "Completed", label: "Completed" },
              { value: "No-Show", label: "No-Show" },
              { value: "Cancelled", label: "Cancelled" }
            ]}
          />
        </div>

        <BrandedButton type="submit" variant="primary">
          Filter
        </BrandedButton>
      </form>

      <div className="mt-6">
        <BrandedTable>
          <BrandedTableHeader>
            <BrandedTableCell>Date</BrandedTableCell>
            <BrandedTableCell>Time</BrandedTableCell>
            <BrandedTableCell>Doctor</BrandedTableCell>
            <BrandedTableCell>Patient</BrandedTableCell>
            <BrandedTableCell>Phone</BrandedTableCell>
            <BrandedTableCell>Status</BrandedTableCell>
            <BrandedTableCell />
          </BrandedTableHeader>
          <tbody>
            {appointments.map((appt) => (
              <BrandedTableRow key={appt.id}>
                <BrandedTableCell>{appt.appointment_date}</BrandedTableCell>
                <BrandedTableCell>{appt.appointment_time.slice(0, 5)}</BrandedTableCell>
                <BrandedTableCell>
                  {doctorsById.get(appt.doctor_id)?.name ?? "—"}
                </BrandedTableCell>
                <BrandedTableCell>{appt.patient_name}</BrandedTableCell>
                <BrandedTableCell>{appt.patient_phone}</BrandedTableCell>
                <BrandedTableCell>
                  <StatusBadge status={appt.status} />
                </BrandedTableCell>
                <BrandedTableCell className="text-right">
                  <AppointmentRowActions
                    appointment={appt}
                    doctor={doctorsById.get(appt.doctor_id)!}
                    allDoctors={activeDoctors}
                    onRefresh={() => {}}
                  />
                </BrandedTableCell>
              </BrandedTableRow>
            ))}
            {appointments.length === 0 && (
              <BrandedTableRow>
                <BrandedTableCell colSpan={7} className="text-center py-6">
                  No appointments match these filters.
                </BrandedTableCell>
              </BrandedTableRow>
            )}
          </tbody>
        </BrandedTable>
      </div>

      {filters.doctorId && filters.date && (
        <BroadcastForm doctorId={filters.doctorId} date={filters.date} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, "info" | "success" | "warning" | "danger" | "default"> = {
    Confirmed: "info",
    Completed: "success",
    "No-Show": "warning",
    Cancelled: "danger"
  };

  return (
    <BrandedBadge variant={variantMap[status] ?? "default"} size="sm">
      {status}
    </BrandedBadge>
  );
}
