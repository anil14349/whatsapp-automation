"use client";

import { useMemo, useState } from "react";

/**
 * The clinic's timezone decides what "today" means for every slot and reminder,
 * so it is chosen from the real IANA list rather than typed.
 *
 * The browser's zone is offered as a suggestion only. Applying it automatically
 * would rewrite the clinic's hours the first time a receptionist logged in from
 * somewhere else.
 */
export function TimezoneField({ value }: { value: string }) {
    const [selected, setSelected] = useState(value);

    const device = useMemo(deviceZone, []);
    const catalogue = useMemo(supportedZones, []);

    // A zone saved before this list existed, or a deprecated alias such as
    // Asia/Calcutta, still has to appear or the select would show nothing.
    const zones = useMemo(() => {
        if (!catalogue) {
            return null;
        }

        const extra = [value, selected].filter((z) => z && !catalogue.includes(z));

        return Array.from(new Set([...extra, ...catalogue]));
    }, [catalogue, value, selected]);

    // Asia/Calcutta and Asia/Kolkata are the same place. Offering to swap one
    // for the other is noise that looks like a real difference.
    const suggestDevice = device && !sameZone(device, selected);

    return (
        <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Timezone</span>

            {zones ? (
                <select
                    name="timezone"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                >
                    {zones.map((zone) => (
                        <option key={zone} value={zone}>
                            {zone}
                        </option>
                    ))}
                </select>
            ) : (
                <input
                    name="timezone"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
            )}

            <span className="block text-xs text-slate-400">
                Decides what today means for slots and reminders. It is {formatNow(selected)} there
                now.
            </span>

            {suggestDevice && (
                <button
                    type="button"
                    onClick={() => setSelected(device)}
                    className="text-xs text-brand-600 underline hover:text-brand-700"
                >
                    Use this device&apos;s timezone ({device})
                </button>
            )}
        </label>
    );
}

function supportedZones(): string[] | null {
    const supported = (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;

    if (typeof supported !== "function") {
        return null;
    }

    try {
        return supported("timeZone");
    } catch {
        return null;
    }
}

function deviceZone(): string | null {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
        return null;
    }
}

/**
 * Same clock now and half a year away, so a shared offset that is really just
 * one side of a daylight saving change does not count as the same zone.
 */
function sameZone(a: string, b: string): boolean {
    if (a === b) {
        return true;
    }

    const now = new Date();
    const later = new Date(now.getTime() + 182 * 24 * 60 * 60 * 1000);

    return offsetAt(a, now) === offsetAt(b, now) && offsetAt(a, later) === offsetAt(b, later);
}

function offsetAt(zone: string, when: Date): string | null {
    try {
        return (
            new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset" })
                .formatToParts(when)
                .find((p) => p.type === "timeZoneName")?.value ?? null
        );
    } catch {
        return null;
    }
}

/** Shows the consequence of the choice, so a wrong one is obvious immediately. */
function formatNow(zone: string): string {
    try {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: zone,
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(new Date());
    } catch {
        return "—";
    }
}
