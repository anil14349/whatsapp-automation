/**
 * How the clinic is doing.
 *
 * The owner could see one day's list and nothing else. Everything here is
 * counted from appointments that actually happened rather than from an events
 * table, because the events table has never held a row.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";

type Range = "today" | "week" | "month";

const RANGES: Array<{ value: Range; label: string }> = [
    { value: "today", label: "Today" },
    { value: "week", label: "Last 7 days" },
    { value: "month", label: "Last 30 days" }
];

const SOURCE_LABELS: Record<string, string> = {
    WHATSAPP: "WhatsApp",
    WALK_IN: "Front desk",
    PORTAL: "Portal",
    IMPORTED: "Imported"
};

const LOCATION_LABELS: Record<string, string> = {
    CLINIC: "At the clinic",
    HOME: "Home visits"
};

interface Summary {
    from: string;
    to: string;
    booked: number;
    completed: number;
    noShow: number;
    cancelled: number;
    stillToBeSeen: number;
    noShowRate: number | null;
    revisits: number;
    bySource: Record<string, number>;
    byLocation: Record<string, number>;
    byDoctor: Array<{ name: string; count: number }>;
    busiestHours: Array<{ hour: string; count: number }>;
    feedback: { rated: number; average: number | null };
    documents: { sent: number; failed: number };
    reminders: { sent: number; failed: number };
    truncated: boolean;
}

export default async function SummaryPage({
    searchParams
}: {
    searchParams: Promise<{ range?: string }>;
}) {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    if (session.role !== "CLINIC_OWNER" && session.role !== "ADMIN") {
        redirect("/appointments");
    }

    const asked = (await searchParams).range;
    const range: Range = asked === "today" || asked === "month" ? asked : "week";

    const result = await callAsUser(`clinic-summary?range=${range}`);

    if (result.status === 401) {
        redirect("/login");
    }

    const branding = await loadBranding();
    const summary: Summary | null = result.ok ? result.data?.summary ?? null : null;

    return (
        <PortalShell session={session} branding={branding}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">Summary</h1>
                    {summary && (
                        <p className="text-sm text-slate-500">
                            {summary.from === summary.to
                                ? summary.from
                                : `${summary.from} to ${summary.to}`}
                        </p>
                    )}
                </div>

                <div className="flex gap-2">
                    {RANGES.map((option) => (
                        <Link
                            key={option.value}
                            href={`/summary?range=${option.value}`}
                            className={`rounded-lg border px-3 py-2 text-sm transition ${
                                range === option.value
                                    ? "border-brand-500 bg-brand-50 text-brand-700"
                                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                            }`}
                        >
                            {option.label}
                        </Link>
                    ))}
                </div>
            </div>

            {!summary && (
                <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {result.data?.error ?? "Could not build the summary."}
                </p>
            )}

            {summary && (
                <div className="space-y-4">
                    {summary.truncated && (
                        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            This period has more appointments than can be counted at once, so the
                            figures below cover only part of it. Choose a shorter period.
                        </p>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Booked" value={summary.booked} />
                        <Stat label="Seen" value={summary.completed} />
                        <Stat
                            label="Did not turn up"
                            value={summary.noShow}
                            note={
                                summary.noShowRate === null
                                    ? "nobody seen yet"
                                    : `${summary.noShowRate}% of those due`
                            }
                            tone={summary.noShowRate !== null && summary.noShowRate >= 20 ? "warn" : "plain"}
                        />
                        <Stat label="Still to be seen" value={summary.stillToBeSeen} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <Panel title="Where the bookings came from" empty="No bookings yet.">
                            <Bars
                                rows={Object.entries(summary.bySource).map(([key, count]) => ({
                                    label: SOURCE_LABELS[key] ?? key,
                                    count
                                }))}
                            />
                        </Panel>

                        <Panel title="Clinic or home" empty="No bookings yet.">
                            <Bars
                                rows={Object.entries(summary.byLocation).map(([key, count]) => ({
                                    label: LOCATION_LABELS[key] ?? key,
                                    count
                                }))}
                            />
                        </Panel>

                        <Panel title="By doctor" empty="No bookings yet.">
                            <Bars rows={summary.byDoctor.map((d) => ({ label: d.name, count: d.count }))} />
                        </Panel>

                        <Panel title="Busiest times" empty="No bookings yet.">
                            <Bars
                                rows={summary.busiestHours.map((h) => ({
                                    label: h.hour,
                                    count: h.count
                                }))}
                            />
                        </Panel>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <Stat
                            label="Patient rating"
                            value={summary.feedback.average ?? "—"}
                            note={
                                summary.feedback.rated === 0
                                    ? "nobody has rated yet"
                                    : `from ${summary.feedback.rated} ${summary.feedback.rated === 1 ? "patient" : "patients"}`
                            }
                        />
                        <Stat
                            label="Reports sent"
                            value={summary.documents.sent}
                            note={summary.documents.failed > 0 ? `${summary.documents.failed} did not send` : undefined}
                            tone={summary.documents.failed > 0 ? "warn" : "plain"}
                        />
                        <Stat
                            label="Reminders sent"
                            value={summary.reminders.sent}
                            note={summary.reminders.failed > 0 ? `${summary.reminders.failed} did not send` : undefined}
                            tone={summary.reminders.failed > 0 ? "warn" : "plain"}
                        />
                    </div>

                    <p className="text-xs text-slate-400">
                        Returning patients in this period: {summary.revisits}. Cancelled:{" "}
                        {summary.cancelled}, which are left out of the figures above.
                    </p>
                </div>
            )}
        </PortalShell>
    );
}

function Stat({
    label,
    value,
    note,
    tone = "plain"
}: {
    label: string;
    value: number | string;
    note?: string;
    tone?: "plain" | "warn";
}) {
    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {label}
            </div>
            <div
                className={`mt-1 text-2xl font-semibold ${
                    tone === "warn" ? "text-amber-700" : "text-slate-900"
                }`}
            >
                {value}
            </div>
            {note && <div className="mt-0.5 text-xs text-slate-400">{note}</div>}
        </div>
    );
}

function Panel({
    title,
    empty,
    children
}: {
    title: string;
    empty: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-semibold">{title}</h2>
            {children ?? <p className="text-sm text-slate-400">{empty}</p>}
        </div>
    );
}

/**
 * Bars rather than numbers alone: the shape of a day is the point, and a
 * column of figures hides it.
 */
function Bars({ rows }: { rows: Array<{ label: string; count: number }> }) {
    if (rows.length === 0) {
        return <p className="text-sm text-slate-400">Nothing yet.</p>;
    }

    const most = Math.max(...rows.map((r) => r.count), 1);

    return (
        <ul className="space-y-1.5">
            {rows.map((row) => (
                <li key={row.label} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 truncate text-slate-600">{row.label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                            className="block h-full rounded-full bg-brand-500"
                            style={{ width: `${Math.round((row.count / most) * 100)}%` }}
                        />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-slate-500">
                        {row.count}
                    </span>
                </li>
            ))}
        </ul>
    );
}
