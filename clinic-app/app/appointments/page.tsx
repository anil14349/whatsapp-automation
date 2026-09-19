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
import { AppointmentFilters } from "./filters";
import type { DoctorOption } from "./walk-in-form";
import { AppointmentTable, type AppointmentRow } from "./appointment-table";
import type { ServiceOption } from "./actions";

/**
 * A cancelled visit is not a booking. Counting it as one made a day of three
 * cancellations read "3 booked", and the summary page already leaves them out.
 */
function daySummary(rows: AppointmentRow[]): string {
    const cancelled = rows.filter((r) => r.status === "CANCELLED").length;
    const booked = rows.length - cancelled;
    // A moved appointment is still ahead of the clinic, which is how the
    // booking guards already treat it.
    const toBeSeen = rows.filter(
        (r) => r.status === "CONFIRMED" || r.status === "RESCHEDULED"
    ).length;

    const parts = [`${booked} booked`, `${toBeSeen} still to be seen`];

    if (cancelled > 0) {
        parts.push(`${cancelled} cancelled`);
    }

    return parts.join(" · ");
}

/** Postgres gives back "10:00:00", the booking form gives "10:00". */
function minutesOfDay(time: string): number {
    const [hours, minutes] = String(time ?? "").split(":");
    return Number(hours) * 60 + Number(minutes ?? 0);
}

// Two visits at the same minute are common, so the tie is broken rather than
// left to whatever order the database happened to return.
function byTimeThenToken(a: AppointmentRow, b: AppointmentRow): number {
    const byTime = minutesOfDay(a.time) - minutesOfDay(b.time);

    if (byTime !== 0) {
        return byTime;
    }

    const byToken = (a.token ?? Number.MAX_SAFE_INTEGER) - (b.token ?? Number.MAX_SAFE_INTEGER);

    return byToken !== 0 ? byToken : a.patientName.localeCompare(b.patientName);
}

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

    const canBook = session.role === "RECEPTIONIST" || session.role === "CLINIC_OWNER";

    // All four were awaited one after another, and each edge function call
    // costs the best part of a second, so the page sat for four of them before
    // rendering. None depends on the others.
    const [result, doctorList, serviceList, branding] = await Promise.all([
        isDoctor
            ? callAsUser(`doctors-appointments${chosenDate ? `?date=${chosenDate}` : ""}`)
            : callAsUser(`receptionists-appointments${query}`),
        canBook
            ? callAsUser("receptionists-appointments?resource=doctors")
            : Promise.resolve(null),
        canBook
            ? callAsUser("receptionists-appointments?resource=services")
            : Promise.resolve(null),
        loadBranding()
    ]);

    if (result.status === 401) {
        redirect("/login");
    }

    const date = chosenDate ?? result.data?.date ?? "";

    const doctors: DoctorOption[] = doctorList?.data?.doctors ?? [];

    const services: ServiceOption[] = serviceList?.data?.services ?? [];

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
            // The two endpoints name these differently.
            serviceName: a.service_type?.name ?? a.serviceType?.name ?? null,
            notes: a.notes ?? "",
            bookingSource: a.booking_source ?? null,
            isRevisit: a.is_revisit === true || a.isRevisit === true,
            token: a.token_number ?? a.tokenNumber ?? null,
            locationType: a.location_type ?? a.locationType ?? null,
            status: a.status
        }))
        : [];

    // A day's list reads by time. Search results read newest first, which the
    // endpoint has already ordered, so they are left alone.
    if (!searching) {
        rows.sort(byTimeThenToken);
    }

    return (
        <PortalShell session={session} branding={branding}>
            <AppointmentFilters>
            <DayHeader
                date={date}
                doctors={doctors}
                canBook={canBook}
                canSearch={!isDoctor}
                term={term}
                searching={searching}
                canFilterByPlace={!isDoctor}
                counts={
                    rows.length > 0
                        ? {
                              all: rows.length,
                              waiting: rows.filter(
                                  (r) => r.status === "CONFIRMED" || r.status === "RESCHEDULED"
                              ).length,
                              seen: rows.filter((r) => r.status === "COMPLETED").length,
                              clinic: rows.filter((r) => r.locationType !== "HOME").length,
                              home: rows.filter((r) => r.locationType === "HOME").length
                          }
                        : undefined
                }
                summary={
                    searching
                        ? `${rows.length} found${rows.length === 50 ? " (showing the 50 most recent)" : ""}`
                        : canBook || isDoctor
                            ? daySummary(rows)
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
            </AppointmentFilters>
        </PortalShell>
    );
}
