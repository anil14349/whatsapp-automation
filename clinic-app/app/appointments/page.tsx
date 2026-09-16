/**
 * The day's appointments.
 *
 * Doctors and receptionists have separate endpoints with different shapes, so
 * both are normalised here rather than in the view.
 */

import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalNav } from "@/app/nav";
import { WalkInForm, type DoctorOption } from "./walk-in-form";
import { AppointmentTable, type AppointmentRow } from "./appointment-table";
import type { ServiceOption } from "./actions";

export default async function AppointmentsPage({
    searchParams
}: {
    searchParams: Promise<{ date?: string }>;
}) {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    // No date means today at the clinic, which only the server knows: this
    // portal may be running in a different timezone entirely.
    const chosenDate = (await searchParams).date;
    const isDoctor = session.role === "DOCTOR";

    const query = chosenDate ? `?date=${chosenDate}` : "";

    const result = isDoctor
        ? await callAsUser(`doctors-appointments${query}`)
        : await callAsUser(`receptionists-appointments${query}`);

    if (result.status === 401) {
        redirect("/login");
    }

    const date = chosenDate ?? result.data?.date ?? "";

    const canBook = session.role === "RECEPTIONIST" || session.role === "CLINIC_OWNER";

    const doctors: DoctorOption[] = canBook
        ? (await callAsUser("receptionists-appointments?resource=doctors")).data?.doctors ?? []
        : [];

    const services: ServiceOption[] = canBook
        ? (await callAsUser("receptionists-appointments?resource=services")).data?.services ?? []
        : [];

    const rows: AppointmentRow[] = result.ok
        ? (result.data.appointments ?? []).map((a: any) => ({
            id: a.id,
            time: a.time ?? a.appointment_time,
            patientName: a.patient?.name ?? a.patient_name ?? "Unknown",
            patientPhone: a.patient?.phone ?? a.patient_phone ?? "",
            doctorId: a.doctor?.id ?? a.doctor_id ?? null,
            doctorName: a.doctor?.name ?? null,
            serviceTypeId: a.service_type_id ?? null,
            serviceName: a.service_type?.name ?? null,
            notes: a.notes ?? "",
            bookingSource: a.booking_source ?? null,
            isRevisit: a.is_revisit === true,
            status: a.status
        }))
        : [];

    rows.sort((a, b) => a.time.localeCompare(b.time));

    return (
        <main className="mx-auto max-w-5xl p-6">
            <PortalNav session={session} />

            <h1 className="mb-4 text-xl font-semibold">Appointments</h1>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <form className="flex items-center gap-2">
                    <input
                        type="date"
                        name="date"
                        defaultValue={date}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                    <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-slate-300">
                        Show
                    </button>
                </form>

                {canBook && (
                    <div className="text-sm text-slate-500">
                        {rows.length} booked ·{" "}
                        {rows.filter((r) => r.status === "CONFIRMED").length} still to be seen
                    </div>
                )}
            </div>

            {canBook && (
                <div className="mb-6">
                    <WalkInForm doctors={doctors} date={date} />
                </div>
            )}

            {!result.ok && (
                <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {result.data?.error ?? "Could not load appointments."}
                </p>
            )}

            {result.ok && rows.length === 0 && (
                <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
                    No appointments on {date}.
                </p>
            )}

            {rows.length > 0 && (
                <AppointmentTable
                    rows={rows}
                    date={date}
                    showDoctor={!isDoctor}
                    canEdit={canBook}
                    isDoctor={isDoctor}
                    doctors={doctors}
                    services={services}
                />
            )}
        </main>
    );
}
