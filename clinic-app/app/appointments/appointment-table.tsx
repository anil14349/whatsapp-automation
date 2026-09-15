"use client";

import { useState, useTransition } from "react";
import { loadSlots, updateAppointment, updateOwnAppointmentStatus, type BookingState } from "./actions";

export interface AppointmentRow {
    id: string;
    time: string;
    patientName: string;
    patientPhone: string;
    doctorId: string | null;
    doctorName: string | null;
    status: string;
}

const STATUS_STYLES: Record<string, string> = {
    CONFIRMED: "bg-blue-50 text-blue-700",
    COMPLETED: "bg-emerald-50 text-emerald-700",
    NO_SHOW: "bg-amber-50 text-amber-700",
    CANCELLED: "bg-slate-100 text-slate-500"
};

export function AppointmentTable({
    rows,
    date,
    showDoctor,
    canEdit,
    isDoctor = false
}: {
    rows: AppointmentRow[];
    date: string;
    showDoctor: boolean;
    canEdit: boolean;
    isDoctor?: boolean;
}) {
    const [notice, setNotice] = useState<BookingState>({});
    const [busy, start] = useTransition();
    const [moving, setMoving] = useState<AppointmentRow | null>(null);
    const [slots, setSlots] = useState<string[]>([]);
    const [newDate, setNewDate] = useState(date);

    function run(fn: () => Promise<BookingState>) {
        start(async () => setNotice(await fn()));
    }

    function beginMove(row: AppointmentRow) {
        setMoving(row);
        setNotice({});
        setNewDate(date);

        if (row.doctorId) {
            start(async () => setSlots(await loadSlots(row.doctorId!, date)));
        }
    }

    function changeMoveDate(value: string) {
        setNewDate(value);

        if (moving?.doctorId) {
            start(async () => setSlots(await loadSlots(moving.doctorId!, value)));
        }
    }

    return (
        <div className="space-y-3">
            {notice.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {notice.error}
                </p>
            )}
            {notice.success && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                    {notice.success}
                </p>
            )}

            {moving && (
                <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                            Move {moving.patientName} ({moving.time})
                        </h3>
                        <button
                            onClick={() => setMoving(null)}
                            className="text-sm text-slate-500 hover:text-slate-700"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                        <label className="space-y-1">
                            <span className="block text-xs font-medium text-slate-600">New date</span>
                            <input
                                type="date"
                                value={newDate}
                                onChange={(e) => changeMoveDate(e.target.value)}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                        </label>

                        <label className="space-y-1">
                            <span className="block text-xs font-medium text-slate-600">New time</span>
                            <select
                                id="move-time"
                                disabled={busy || slots.length === 0}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                            >
                                {slots.length === 0 && <option value="">No free slots</option>}
                                {slots.map((slot) => (
                                    <option key={slot} value={slot}>
                                        {slot}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <button
                            disabled={busy || slots.length === 0}
                            onClick={() => {
                                const select = document.getElementById("move-time") as HTMLSelectElement;
                                const time = select?.value;

                                if (!time) return;

                                run(async () => {
                                    const result = await updateAppointment(moving.id, "reschedule", {
                                        date: newDate,
                                        time
                                    });
                                    if (!result.error) setMoving(null);
                                    return result;
                                });
                            }}
                            className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                        >
                            Move appointment
                        </button>
                    </div>
                </div>
            )}

            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                            <th className="px-4 py-3">Time</th>
                            <th className="px-4 py-3">Patient</th>
                            {showDoctor && <th className="px-4 py-3">Doctor</th>}
                            <th className="px-4 py-3">Status</th>
                            {(canEdit || isDoctor) && <th className="px-4 py-3 text-right">Actions</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => {
                            const open = row.status === "CONFIRMED";

                            return (
                                <tr key={row.id}>
                                    <td className="px-4 py-3 font-medium">{row.time}</td>
                                    <td className="px-4 py-3">
                                        <div>{row.patientName}</div>
                                        <div className="text-xs text-slate-400">{row.patientPhone}</div>
                                    </td>
                                    {showDoctor && (
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
                                    {canEdit && (
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap justify-end gap-1.5">
                                                {open && (                                                    <>
                                                        <button
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(() =>
                                                                    updateAppointment(row.id, "status", {
                                                                        status: "COMPLETED"
                                                                    })
                                                                )
                                                            }
                                                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                        >
                                                            Seen
                                                        </button>
                                                        <button
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(() =>
                                                                    updateAppointment(row.id, "status", {
                                                                        status: "NO_SHOW"
                                                                    })
                                                                )
                                                            }
                                                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                        >
                                                            No-show
                                                        </button>
                                                        <button
                                                            disabled={busy || !row.doctorId}
                                                            onClick={() => beginMove(row)}
                                                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                        >
                                                            Move
                                                        </button>
                                                        <button
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(() => updateAppointment(row.id, "cancel"))
                                                            }
                                                            className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:border-red-300 disabled:opacity-50"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                                {!open && row.status !== "CANCELLED" && (
                                                    <button
                                                        disabled={busy}
                                                        onClick={() =>
                                                            run(() =>
                                                                updateAppointment(row.id, "status", {
                                                                    status: "CONFIRMED"
                                                                })
                                                            )
                                                        }
                                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                    >
                                                        Reopen
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                    {isDoctor && (
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap justify-end gap-1.5">
                                                {open && (
                                                    <>
                                                        <button
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(() =>
                                                                    updateOwnAppointmentStatus(row.id, "COMPLETED")
                                                                )
                                                            }
                                                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                        >
                                                            Seen
                                                        </button>
                                                        <button
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(() =>
                                                                    updateOwnAppointmentStatus(row.id, "NO_SHOW")
                                                                )
                                                            }
                                                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                        >
                                                            No-show
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
