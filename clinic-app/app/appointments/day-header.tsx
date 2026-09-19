"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { announceDelay, type BookingState } from "./actions";
import { WalkInForm, type DoctorOption } from "./walk-in-form";
import { useAppointmentFilters, type FilterCounts } from "./filters";
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
    searching = false,
    counts
}: {
    date: string;
    summary?: string;
    doctors: DoctorOption[];
    canBook: boolean;
    canSearch?: boolean;
    term?: string;
    searching?: boolean;
    /** Absent when the day has nothing to filter. */
    counts?: FilterCounts;
}) {
    const [walkIn, setWalkIn] = useState(false);
    const [delay, setDelay] = useState(false);
    const [notice, setNotice] = useNotice<BookingState>({});
    const [busy, start] = useTransition();

    return (
        <>
            {/* Three things, not one row of four: what the page is and its one
                action, then the tools for finding a day. Running late sits with
                the tools because it is an action the desk takes rarely, and as
                a second solid button it read as a peer of Book walk-in. */}
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">
                        {searching ? "Search" : "Appointments"}
                    </h1>
                    {summary && <p className="text-sm text-slate-500">{summary}</p>}
                </div>

                {!searching && canBook && doctors.length > 0 && (
                    <button
                        onClick={() => {
                            setWalkIn(!walkIn);
                            setDelay(false);
                        }}
                        className={`${TOOLBAR_HEIGHT} inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600`}
                    >
                        <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                            className="h-4 w-4"
                        >
                            <path d="M8 3.5v9M3.5 8h9" />
                        </svg>
                        Book walk-in
                    </button>
                )}
            </div>

            {/* One strip rather than loose controls: the day's tools and the
                filters are the same job, and two rows of them pushed the
                appointments themselves down the screen. */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                {canSearch && <SearchBox term={term} />}

                {!searching && <DateNav date={date} />}

                {!searching && <TodayButton />}

                {counts && <StateTabs counts={counts} />}

                {/* Home visits and clinic visits are different work. Only
                    offered when the day actually holds both. */}
                {counts && counts.home > 0 && counts.clinic > 0 && <PlacePicker />}

                {/* Acts on a single day, and a search has none. */}
                {!searching && canBook && doctors.length > 0 && (
                    <button
                        onClick={() => {
                            setDelay(!delay);
                            setWalkIn(false);
                        }}
                        className={`${TOOLBAR_HEIGHT} ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100`}
                    >
                        <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            aria-hidden="true"
                            className="h-4 w-4"
                        >
                            <circle cx="8" cy="8" r="6" />
                            <path d="M8 4.75V8l2 1.5" strokeLinecap="round" />
                        </svg>
                        Running late
                    </button>
                )}
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
        //
        // Flexible rather than fixed: at a fixed width it held its size and
        // pushed Running late onto a second row instead of giving up space.
        <form onSubmit={submit} className="relative min-w-[17rem] max-w-[19rem] flex-1">
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
                placeholder="Search by patient name or number"
                aria-label="Search appointments by patient name or number"
                className={`${TOOLBAR_HEIGHT} w-full rounded-lg border border-slate-200 pl-8 text-sm outline-none focus:border-brand-500 ${
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
        </div>
    );
}

/**
 * Today sat inside the date stepper, where it read as a third arrow rather
 * than as the way back to the day the desk actually works on.
 */
function TodayButton() {
    const router = useRouter();

    return (
        <button
            onClick={() => router.push("/appointments")}
            className={`${TOOLBAR_HEIGHT} rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50`}
        >
            Today
        </button>
    );
}

/** Who is still to be seen is the question the desk asks all day. */
function StateTabs({ counts }: { counts: FilterCounts }) {
    const { state, setState } = useAppointmentFilters();

    return (
        <div className={`${TOOLBAR_HEIGHT} flex items-center gap-1 rounded-lg bg-slate-100 p-1`}>
            {(
                [
                    ["ALL", "All", counts.all],
                    ["WAITING", "Waiting", counts.waiting],
                    ["SEEN", "Seen", counts.seen]
                ] as const
            ).map(([value, label, count]) => (
                <button
                    key={value}
                    onClick={() => setState(value)}
                    aria-pressed={state === value}
                    className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
                        state === value
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-500 hover:text-slate-900"
                    }`}
                >
                    {label} <span className="tabular-nums text-slate-400">{count}</span>
                </button>
            ))}
        </div>
    );
}

function PlacePicker() {
    const { place, setPlace } = useAppointmentFilters();

    return (
        <label className="flex items-center gap-2 text-sm text-slate-500">
            Location:
            {/* No counts in the options: a select is as wide as its longest
                one, and the room went to the search box instead. */}
            <select
                value={place}
                onChange={(e) => setPlace(e.target.value as typeof place)}
                className={`${TOOLBAR_HEIGHT} rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-brand-500`}
            >
                <option value="ALL">All locations</option>
                <option value="CLINIC">At the clinic</option>
                <option value="HOME">Home visits</option>
            </select>
        </label>
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
