/**
 * The waiting room, as the front desk sees it.
 *
 * The question this answers is the one asked across the counter all day: which
 * token is inside, and how many are in front of me. Both were already knowable
 * from the day's list, but only by reading down it and working out which rows
 * had been marked — which is how a desk ends up guessing.
 *
 * Refreshes itself, because a board nobody remembers to reload is a board that
 * lies.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { callAsUser, readSession } from "@/lib/portal";
import { PortalShell, loadBranding } from "@/app/shell";

interface QueueEntry {
    appointmentId: string;
    token: number | null;
    patientName: string;
    time: string;
    notified: boolean;
}

interface DoctorQueue {
    doctorId: string;
    doctorName: string;
    nowSeeing: QueueEntry | null;
    next: QueueEntry | null;
    waiting: number;
    seen: number;
    started: boolean;
}

export const dynamic = "force-dynamic";

export default async function QueuePage() {
    const session = await readSession();

    if (!session) {
        redirect("/login");
    }

    // The endpoint refuses a doctor, so the nav hides the link. Someone who
    // types the path would otherwise get an error where an explanation belongs.
    if (session.role === "DOCTOR") {
        redirect("/appointments");
    }

    const [result, branding] = await Promise.all([
        callAsUser("receptionists-appointments?resource=queue"),
        loadBranding()
    ]);

    if (result.status === 401) {
        redirect("/login");
    }

    const doctors: DoctorQueue[] = result.ok ? (result.data?.doctors ?? []) : [];

    return (
        <PortalShell session={session} branding={branding}>
            {/* Cheaper than a socket and good enough for a room where the
                unit of change is a whole consultation. */}
            <meta httpEquiv="refresh" content="30" />

            <div className="space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                        <h1 className="text-lg font-semibold text-slate-900">Queue</h1>
                        <p className="text-sm text-slate-500">
                            Who is in the room now, and who is next. Updates itself.
                        </p>
                    </div>
                    <Link
                        href="/appointments"
                        className="text-sm font-medium text-brand-500 hover:underline"
                    >
                        Full day list
                    </Link>
                </div>

                {!result.ok && (
                    <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
                        {result.data?.error ?? "Could not read the queue."}
                    </p>
                )}

                {result.ok && doctors.length === 0 && (
                    <p className="rounded-xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
                        Nobody is booked with a doctor today.
                    </p>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                    {doctors.map((queue) => (
                        <DoctorCard key={queue.doctorId} queue={queue} />
                    ))}
                </div>
            </div>
        </PortalShell>
    );
}

function DoctorCard({ queue }: { queue: DoctorQueue }) {
    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">{queue.doctorName}</h2>
                <span className="text-xs text-slate-500">
                    {queue.seen} seen
                    {queue.waiting > 0 && ` · ${queue.waiting} further back`}
                </span>
            </div>

            <Slot
                label={queue.started ? "In the room" : "First up"}
                entry={queue.nowSeeing}
                empty={queue.started ? "Nobody left to see" : "Not started"}
                strong
            />

            <div className="mt-2">
                <Slot label="Next" entry={queue.next} empty="Nobody waiting" />
            </div>
        </div>
    );
}

function Slot({
    label,
    entry,
    empty,
    strong = false
}: {
    label: string;
    entry: QueueEntry | null;
    empty: string;
    strong?: boolean;
}) {
    if (!entry) {
        return (
            <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="text-sm text-slate-500">{empty}</p>
            </div>
        );
    }

    return (
        <div className={`rounded-lg px-3 py-2.5 ${strong ? "bg-brand-50" : "bg-slate-50"}`}>
            <p className="text-xs font-medium text-slate-500">{label}</p>

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {entry.token !== null && (
                    <span
                        className={`tabular-nums ${
                            strong
                                ? "text-2xl font-semibold text-slate-900"
                                : "text-lg font-semibold text-slate-700"
                        }`}
                    >
                        {entry.token}
                    </span>
                )}
                <span className="text-sm font-medium text-slate-900">{entry.patientName}</span>
                <span className="ml-auto text-xs text-slate-500 tabular-nums">{entry.time}</span>
            </div>

            {/* A notice is only attempted for whoever is at the front, so this
                would be noise against the person behind them. */}
            {strong && !entry.notified && (
                <p className="mt-1 text-xs text-amber-800">
                    Not messaged — call their name
                </p>
            )}
        </div>
    );
}
