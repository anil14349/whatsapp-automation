"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { announceDelay, type BookingState } from "./actions";
import { WalkInForm, type DoctorOption } from "./walk-in-form";
import { useNotice } from "@/lib/use-notice";

/**
 * The day's controls in one line.
 *
 * The date, the walk-in button and the delay button were three stacked rows
 * above the table, which pushed the appointments themselves off the top of a
 * laptop screen. The forms still open full width below, because they are forms.
 */
export function DayHeader({
    date,
    summary,
    doctors,
    canBook
}: {
    date: string;
    summary?: string;
    doctors: DoctorOption[];
    canBook: boolean;
}) {
    const [walkIn, setWalkIn] = useState(false);
    const [delay, setDelay] = useState(false);
    const [notice, setNotice] = useNotice<BookingState>({});
    const [busy, start] = useTransition();

    return (
        <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">Appointments</h1>
                    {summary && <p className="text-sm text-slate-500">{summary}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <DateNav date={date} />

                    {canBook && doctors.length > 0 && (
                        <>
                            <button
                                onClick={() => {
                                    setDelay(!delay);
                                    setWalkIn(false);
                                }}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:border-amber-300"
                            >
                                Running late
                            </button>
                            <button
                                onClick={() => {
                                    setWalkIn(!walkIn);
                                    setDelay(false);
                                }}
                                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                            >
                                Book walk-in
                            </button>
                        </>
                    )}
                </div>
            </div>

            {notice.error && (
                <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {notice.error}
                </p>
            )}
            {notice.success && (
                <p
                    className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                    role="status"
                >
                    {notice.success}
                </p>
            )}

            {canBook && doctors.length === 0 && (
                <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    No active doctors at this clinic yet, so walk-ins cannot be booked.
                </p>
            )}

            {delay && (
                <DelayPanel
                    doctors={doctors}
                    busy={busy}
                    onClose={() => setDelay(false)}
                    onSend={(doctorId, minutes) => {
                        setDelay(false);
                        start(async () => setNotice(await announceDelay(doctorId, minutes)));
                    }}
                />
            )}

            {walkIn && (
                <div className="mb-6">
                    <WalkInForm doctors={doctors} date={date} onClose={() => setWalkIn(false)} />
                </div>
            )}
        </>
    );
}

/**
 * Stepping to the next or previous day matters more than picking one: the desk
 * spends its time on today and tomorrow. Today has no date in the query at all,
 * so the server decides it in the clinic's own timezone.
 */
function DateNav({ date }: { date: string }) {
    const router = useRouter();

    function go(to: string | null) {
        router.push(to ? `/appointments?date=${to}` : "/appointments");
    }

    return (
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <button
                onClick={() => go(shift(date, -1))}
                aria-label="Previous day"
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
                ‹
            </button>

            <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && go(e.target.value)}
                aria-label="Show a date"
                className="border-0 bg-transparent px-1 text-sm focus:outline-none"
            />

            <button
                onClick={() => go(shift(date, 1))}
                aria-label="Next day"
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
                ›
            </button>

            <button
                onClick={() => go(null)}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
                Today
            </button>
        </div>
    );
}

/** String maths, so stepping a day cannot drift across a timezone. */
function shift(date: string, days: number): string {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function DelayPanel({
    doctors,
    busy,
    onClose,
    onSend
}: {
    doctors: DoctorOption[];
    busy: boolean;
    onClose: () => void;
    onSend: (doctorId: string, minutes: number) => void;
}) {
    const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
    const [minutes, setMinutes] = useState(15);

    return (
        <div className="mb-6 rounded-xl bg-white p-4 ring-1 ring-amber-200">
            <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Running late</h2>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
                    Close
                </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
                Messages everyone still waiting for this doctor today. Booked times do not change.
            </p>

            <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Doctor</span>
                    <select
                        value={doctorId}
                        onChange={(e) => setDoctorId(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    >
                        {doctors.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.name}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Minutes late</span>
                    <input
                        type="number"
                        min={5}
                        max={300}
                        step={5}
                        value={minutes}
                        onChange={(e) => setMinutes(Number(e.target.value))}
                        className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>

                <button
                    disabled={busy || !doctorId}
                    onClick={() => onSend(doctorId, minutes)}
                    className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                    Tell waiting patients
                </button>
            </div>
        </div>
    );
}
