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

type ViewType = "today" | "future" | "history";

function isValidViewType(value: string | undefined): value is ViewType {
  return ["today", "future", "history"].includes(value ?? "");
}

export default async function AppointmentsPage({
  searchParams
}: {
  searchParams: Promise<{ doctorId?: string; date?: string; status?: string; view?: string }>;
}) {
  await requireAdminRole(["ADMIN", "RECEPTIONIST"]);
  const filters = await searchParams;
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const doctors = await listDoctors(supabase);
  const activeDoctors = doctors.filter((d) => d.active);

  const today = formatDateKey(new Date(), env.CLINIC_TIMEZONE);
  const tomorrow = formatDateKey(new Date(Date.now() + 86400000), env.CLINIC_TIMEZONE);
  const thirtyDaysAgo = formatDateKey(new Date(Date.now() - 30 * 86400000), env.CLINIC_TIMEZONE);

  // Determine view type (default: today)
  const viewType: ViewType = isValidViewType(filters.view) ? filters.view : "today";

  let query = supabase
    .from("appointments")
    .select("*")
    .order("appointment_date", { ascending: false })
    .order("appointment_time")
    .limit(200);

  if (filters.doctorId) {
    query = query.eq("doctor_id", filters.doctorId);
  }

  // Apply view filter
  if (filters.date) {
    // Custom date filter takes precedence
    query = query.eq("appointment_date", filters.date);
  } else {
    // View-based filtering
    switch (viewType) {
      case "today":
        // Show only today's appointments
        query = query.eq("appointment_date", today);
        break;
      case "future":
        // Show tomorrow onwards (next 30 days)
        query = query.gte("appointment_date", tomorrow).lte("appointment_date", formatDateKey(new Date(Date.now() + 30 * 86400000), env.CLINIC_TIMEZONE));
        break;
      case "history":
        // Show past 30 days
        query = query.gte("appointment_date", thirtyDaysAgo).lt("appointment_date", today);
        break;
    }
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
        {viewType === "today" && "Showing today's appointments"}
        {viewType === "future" && "Showing upcoming appointments (next 30 days)"}
        {viewType === "history" && "Showing past appointments (last 30 days)"}
        {filters.date && " • Custom date filter applied"}
      </p>

      {/* View Filter Buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`?${new URLSearchParams({
            ...filters,
            view: "today",
            date: "",
          }).toString()}`}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            viewType === "today"
              ? "bg-blue-600 text-white"
              : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          }`}
        >
          📅 Today
        </a>
        <a
          href={`?${new URLSearchParams({
            ...filters,
            view: "future",
            date: "",
          }).toString()}`}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            viewType === "future"
              ? "bg-blue-600 text-white"
              : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          }`}
        >
          🔮 Future
        </a>
        <a
          href={`?${new URLSearchParams({
            ...filters,
            view: "history",
            date: "",
          }).toString()}`}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            viewType === "history"
              ? "bg-blue-600 text-white"
              : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          }`}
        >
          📜 History
        </a>
      </div>

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
