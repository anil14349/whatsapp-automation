/**
 * The day's appointments.
 *
 * Doctors and receptionists have separate endpoints with different shapes, so
 * both are normalised here rather than in the view.
 */

import { redirect } from "next/navigation";
import { callAsUser, readSession } from "@/lib/portal";
import { SignOutButton } from "./sign-out";
import { WalkInForm, type DoctorOption } from "./walk-in-form";

interface Row {
    id: string;
    time: string;
    patientName: string;
    patientPhone: string;
    doctorName: string | null;
    status: string;
}

function today(): string {
    return new Date().toISOString().split("T")[0];
}

const STATUS_STYLES: Record<string, string> = {
    CONFIRMED: "bg-blue-50 text-blue-700",
    COMPLETED: "bg-emerald-50 text-emerald-700",
    NO_SHOW: "bg-amber-50 text-amber-700",
    CANCELLED: "bg-slate-100 text-slate-500"
};

export default async function AppointmentsPage({
    searchParams
}: {
    searchParams: Promise<{ date?: string }>;
}) {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    const date = (await searchParams).date ?? today();
    const isDoctor = session.role === "DOCTOR";

    const result = isDoctor
        ? await callAsUser(`doctors-appointments?date=${date}`)
        : await callAsUser(`receptionists-appointments?date=${date}`);

    if (result.status === 401) {
        redirect("/login");
    }

    const doctors: DoctorOption[] =
        session.role === "RECEPTIONIST"
            ? (await callAsUser("receptionists-appointments?resource=doctors")).data?.doctors ?? []
            : [];

    const rows: Row[] = result.ok
        ? (result.data.appointments ?? []).map((a: any) => ({
            id: a.id,
            time: a.time ?? a.appointment_time,
            patientName: a.patient?.name ?? a.patient_name ?? "Unknown",
            patientPhone: a.patient?.phone ?? a.patient_phone ?? "",
            doctorName: a.doctor?.name ?? null,
            status: a.status
        }))
        : [];

    rows.sort((a, b) => a.time.localeCompare(b.time));

    return (
        <main className="mx-auto max-w-5xl p-6">
            <header className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Appointments</h1>
                    <p className="text-sm text-slate-500">
                        {session.name} · {session.role.toLowerCase().replace("_", " ")}
                    </p>
                </div>
                <SignOutButton />
            </header>

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

                {session.role === "RECEPTIONIST" && (
                    <div className="text-sm text-slate-500">
                        {rows.length} booked ·{" "}
                        {rows.filter((r) => r.status === "CONFIRMED").length} still to be seen
                    </div>
                )}
            </div>

            {session.role === "RECEPTIONIST" && (
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
                <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                                <th className="px-4 py-3">Time</th>
                                <th className="px-4 py-3">Patient</th>
                                {!isDoctor && <th className="px-4 py-3">Doctor</th>}
                                <th className="px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="px-4 py-3 font-medium">{row.time}</td>
                                    <td className="px-4 py-3">
                                        <div>{row.patientName}</div>
                                        <div className="text-xs text-slate-400">{row.patientPhone}</div>
                                    </td>
                                    {!isDoctor && (
                                        <td className="px-4 py-3 text-slate-600">{row.doctorName ?? "—"}</td>
                                    )}
                                    <td className="px-4 py-3">
                                        <span
                                            className={`rounded-full px-2 py-1 text-xs font-medium ${
                                                STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                                            }`}
                                        >
                                            {row.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </main>
    );
}
