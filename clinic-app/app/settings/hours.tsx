"use client";

import { useState, useTransition } from "react";
import { saveDay, removeClosure, type DayHours, type Holiday, type SettingsState } from "./actions";
import { useNotice } from "@/lib/use-notice";

export function OpeningHours({ hours }: { hours: DayHours[] }) {
    const [notice, setNotice] = useNotice<SettingsState>({});
    const [busy, start] = useTransition();

    const open = hours.filter((d) => !d.closed);
    const [source, setSource] = useState<number | null>(null);
    const from = hours.find((d) => d.dayOfWeek === (source ?? open[0]?.dayOfWeek)) ?? null;

    function copy() {
        if (!from || from.closed) return;

        const targets = open.filter((d) => d.dayOfWeek !== from.dayOfWeek);

        start(async () => {
            for (const day of targets) {
                const result = await saveDay(
                    day.dayOfWeek,
                    from.openTime ?? "09:00",
                    from.closeTime ?? "18:00",
                    false
                );

                // Stop at the first refusal rather than reporting a success
                // that only some of the days got.
                if (result.error) {
                    setNotice(result);
                    return;
                }
            }

            setNotice({
                success: `${from.label} hours copied to ${targets.length} other day${
                    targets.length === 1 ? "" : "s"
                }.`
            });
        });
    }

    return (
        <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">Opening hours</h2>
                <span className="text-xs text-slate-500">
                    {open.length === 0
                        ? "Closed every day"
                        : `Open ${open.length} day${open.length === 1 ? "" : "s"} a week`}
                </span>
            </div>
            <p className="mb-3 text-xs text-slate-500">Set when patients can book appointments.</p>

            <Notice state={notice} />

            <div className="space-y-2">
                {hours.map((day) => (
                    <DayRow
                        // Remounted when the saved values change, or a day altered
                        // by the copy below would keep showing what it held before.
                        key={`${day.dayOfWeek}:${day.openTime}:${day.closeTime}:${day.closed}`}
                        day={day}
                        disabled={busy}
                        onSave={(openTime, closeTime, closed) =>
                            start(async () =>
                                setNotice(await saveDay(day.dayOfWeek, openTime, closeTime, closed))
                            )
                        }
                    />
                ))}
            </div>

            {/* Most clinics keep one set of hours for most of the week, and
                typing them seven times is where the mistakes come from. */}
            {open.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <label className="text-xs text-slate-500" htmlFor="copy-hours-from">
                        Copy
                    </label>
                    <select
                        id="copy-hours-from"
                        value={from?.dayOfWeek ?? ""}
                        disabled={busy}
                        onChange={(e) => setSource(Number(e.target.value))}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    >
                        {open.map((day) => (
                            <option key={day.dayOfWeek} value={day.dayOfWeek}>
                                {day.label}
                            </option>
                        ))}
                    </select>
                    <span className="text-xs text-slate-500">
                        to the other {open.length - 1} open day
                        {open.length - 1 === 1 ? "" : "s"}. Closed days stay closed.
                    </span>
                    <button
                        disabled={busy}
                        onClick={copy}
                        className="ml-auto rounded-lg bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                        Copy hours
                    </button>
                </div>
            )}
        </section>
    );
}

function DayRow({
    day,
    disabled,
    onSave
}: {
    day: DayHours;
    disabled: boolean;
    onSave: (open: string, close: string, closed: boolean) => void;
}) {
    // A closed day is stored as 00:00-00:00, which would be rejected the moment
    // someone ticks Open. Offer a working default instead of the sentinel.
    const [open, setOpen] = useState(day.closed ? "09:00" : (day.openTime ?? "09:00"));
    const [close, setClose] = useState(day.closed ? "18:00" : (day.closeTime ?? "18:00"));
    const [closed, setClosed] = useState(day.closed);

    const changed =
        closed !== day.closed ||
        (!closed && (open !== day.openTime || close !== day.closeTime));

    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
            <span className="w-24 text-sm font-medium">{day.label}</span>

            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={!closed}
                    disabled={disabled}
                    onChange={(e) => setClosed(!e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-slate-500">Open</span>
            </label>

            <input
                type="time"
                value={open}
                disabled={disabled || closed}
                onChange={(e) => setOpen(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />
            <span className="text-slate-500">to</span>
            <input
                type="time"
                value={close}
                disabled={disabled || closed}
                onChange={(e) => setClose(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />

            {changed && (
                <button
                    disabled={disabled}
                    onClick={() => onSave(open, close, closed)}
                    className="ml-auto rounded-lg bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    Save
                </button>
            )}
        </div>
    );
}

export function Closures({ holidays }: { holidays: Holiday[] }) {
    const [notice, setNotice] = useNotice<SettingsState>({});
    const [busy, start] = useTransition();

    if (holidays.length === 0) {
        return (
            <p className="text-sm text-slate-500">
                No closures coming up. The clinic follows its usual hours.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <Notice state={notice} />

            {holidays.map((h) => (
                <div
                    key={h.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                >
                    <div>
                        <span className="text-sm font-medium">{h.holiday_date}</span>
                        <span className="ml-2 text-sm text-slate-500">{h.holiday_name}</span>
                    </div>
                    <button
                        disabled={busy}
                        onClick={() => start(async () => setNotice(await removeClosure(h.id)))}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                    >
                        Remove
                    </button>
                </div>
            ))}
        </div>
    );
}

function Notice({ state }: { state: SettingsState }) {
    if (!state.error && !state.success) {
        return null;
    }

    return (
        <p
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                state.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
            }`}
            role={state.error ? "alert" : "status"}
        >
            {state.error ?? state.success}
        </p>
    );
}
