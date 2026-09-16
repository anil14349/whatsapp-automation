/**
 * The day's appointments.
 *
 * Doctors and receptionists have separate endpoints with different shapes, so
 * both are normalised here rather than in the view.
 */

import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";
import { DayHeader } from "./day-header";
import type { DoctorOption } from "./walk-in-form";
import { AppointmentTable, type AppointmentRow } from "./appointment-table";
import type { ServiceOption } from "./actions";

export default async function AppointmentsPage({
    searchParams
}: {
    searchParams: Promise<{ date?: string; q?: string }>;
}) {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    // No date means today at the clinic, which only the server knows: this
    // portal may be running in a different timezone entirely.
    const params = await searchParams;
    const chosenDate = params.date;
    const term = params.q?.trim() ?? "";
    const isDoctor = session.role === "DOCTOR";

    // Searching spans every date, so it replaces the day filter rather than
    // narrowing it.
    const searching = term.length > 0 && !isDoctor;

    const query = searching
        ? `?q=${encodeURIComponent(term)}`
        : chosenDate
            ? `?date=${chosenDate}`
            : "";

    const result = isDoctor
        ? await callAsUser(`doctors-appointments${chosenDate ? `?date=${chosenDate}` : ""}`)
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

    const branding = await loadBranding();

    const rows: AppointmentRow[] = result.ok
        ? (result.data.appointments ?? []).map((a: any) => ({
            id: a.id,
            date: a.appointment_date ?? a.date ?? date,
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
            token: a.token_number ?? null,
            status: a.status
        }))
        : [];

    // A day's list reads by time. Search results read newest first, which the
    // endpoint has already ordered, so they are left alone.
    if (!searching) {
        rows.sort((a, b) => a.time.localeCompare(b.time));
    }

    return (
        <PortalShell session={session} branding={branding}>
            <DayHeader
                date={date}
                doctors={doctors}
                canBook={canBook}
                canSearch={!isDoctor}
                term={term}
                searching={searching}
                summary={
                    searching
                        ? `${rows.length} found${rows.length === 50 ? " (showing the 50 most recent)" : ""}`
                        : canBook
                            ? `${rows.length} booked · ${rows.filter((r) => r.status === "CONFIRMED").length} still to be seen`
                            : undefined
                }
            />

            {!result.ok && (
                <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {result.data?.error ?? "Could not load appointments."}
                </p>
            )}

            {result.ok && rows.length === 0 && (
                <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
                    {searching
                        ? `Nobody matching “${term}”.`
                        : `No appointments on ${date}.`}
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
                    showDate={searching}
                />
            )}
        </PortalShell>
    );
}
