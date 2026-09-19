"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { announceDelay, type BookingState } from "./actions";
import { WalkInForm, type DoctorOption } from "./walk-in-form";
import { useNotice } from "@/lib/use-notice";

/**
 * One height for everything on the toolbar row.
 *
 * Each control had its own padding, so the search box came out 38px, the date
 * stepper 42 and the walk-in button 36. Centred against each other, nothing
 * shared a top or a bottom edge.
 */
const TOOLBAR_HEIGHT = "h-10";

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
    canBook,
    canSearch = false,
    term = "",
    searching = false
}: {
    date: string;
    summary?: string;
    doctors: DoctorOption[];
    canBook: boolean;
    canSearch?: boolean;
    term?: string;
    searching?: boolean;
}) {
    const [walkIn, setWalkIn] = useState(false);
    const [delay, setDelay] = useState(false);
    const [notice, setNotice] = useNotice<BookingState>({});
    const [busy, start] = useTransition();

    return (
        <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">
                        {searching ? "Search" : "Appointments"}
                    </h1>
                    {summary && <p className="text-sm text-slate-500">{summary}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {canSearch && <SearchBox term={term} />}

                    {!searching && <DateNav date={date} />}

                    {/* Both act on a single day, and a search has none: the
                        walk-in form would post an empty date. */}
                    {!searching && canBook && doctors.length > 0 && (
                        <>
                            <button
                                onClick={() => {
                                    setDelay(!delay);
                                    setWalkIn(false);
                                }}
                                className={`${TOOLBAR_HEIGHT} rounded-lg border border-amber-400 bg-amber-50 px-3 text-sm font-medium text-amber-800 transition hover:bg-amber-100`}
                            >
                                Running late
                            </button>
                            {/* The one thing the desk does most, and the only solid
                                teal on the screen. */}
                            <button
                                onClick={() => {
                                    setWalkIn(!walkIn);
                                    setDelay(false);
                                }}
                                className={`${TOOLBAR_HEIGHT} rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600`}
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
 * Finding a booking without knowing its date.
 *
 * "When is Mrs Sharma coming?" is what the desk is asked when the phone rings,
 * and the only answer the portal had was to step back through days one at a
 * time. A number and a name both work; which column is searched is decided
 * from the shape of what was typed.
 */
function SearchBox({ term }: { term: string }) {
    const router = useRouter();
    const [value, setValue] = useState(term);

    function submit(event: React.FormEvent) {
        event.preventDefault();

        const trimmed = value.trim();

        router.push(trimmed ? `/appointments?q=${encodeURIComponent(trimmed)}` : "/appointments");
    }

    return (
        // The separate Search button was a second thing that looked like a
        // primary action, next to Running late and Book walk-in. Enter submits.
        <form onSubmit={submit} className="relative">
            <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            >
                <circle cx="9" cy="9" r="5.5" />
                <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
            </svg>

            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Name or number"
                aria-label="Search appointments by patient name or number"
                className={`${TOOLBAR_HEIGHT} w-52 rounded-lg border border-slate-200 pl-8 text-sm outline-none focus:border-brand-500 ${
                    term ? "pr-8" : "pr-3"
                }`}
            />

            {term && (
                <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                        setValue("");
                        router.push("/appointments");
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm leading-none text-slate-500 hover:text-slate-700"
                >
                    ×
                </button>
            )}

            <button type="submit" className="sr-only">
                Search
            </button>
        </form>
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
        <div
            className={`${TOOLBAR_HEIGHT} flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1`}
        >
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
