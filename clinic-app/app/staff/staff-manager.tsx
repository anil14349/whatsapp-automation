"use client";

import { useActionState, useState, useTransition } from "react";
import {
    createStaff,
    resetStaffCredential,
    setStaffActive,
    type StaffState,
    type StaffType
} from "./actions";
import { STAFF_LABELS } from "@/lib/labels";
import { PhoneField } from "@/components/phone-field";
import { displayPhone } from "@/lib/phone";

export interface StaffMember {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    specialization?: string | null;
    is_active?: boolean;
    status?: string;
    max_collections_per_day?: number;
}

const TABS: Array<{ type: StaffType; label: string; needs: string }> = [
    { type: "doctor", label: STAFF_LABELS.doctor.plural, needs: "WhatsApp number" },
    { type: "receptionist", label: STAFF_LABELS.receptionist.plural, needs: "Email" },
    { type: "collector", label: STAFF_LABELS.collector.plural, needs: "WhatsApp number" }
];

const INITIAL: StaffState = {};

function isActive(member: StaffMember): boolean {
    return member.status ? member.status === "ACTIVE" : member.is_active !== false;
}

export function StaffManager({
    staff
}: {
    staff: Record<StaffType, StaffMember[]>;
}) {
    const [tab, setTab] = useState<StaffType>("doctor");
    const [state, action, pending] = useActionState(createStaff, INITIAL);
    const [rowState, setRowState] = useState<StaffState>({});
    const [busy, startAction] = useTransition();

    const members = staff[tab] ?? [];
    const active = TABS.find((t) => t.type === tab)!;

    function run(fn: () => Promise<StaffState>) {
        startAction(async () => setRowState(await fn()));
    }

    const notice = rowState.error || rowState.success ? rowState : state;

    return (
        <div className="space-y-6">
            <div className="flex gap-2">
                {TABS.map((option) => (
                    <button
                        key={option.type}
                        onClick={() => {
                            setTab(option.type);
                            setRowState({});
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                            tab === option.type
                                ? "border-brand-500 bg-brand-50 text-brand-700"
                                : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                    >
                        {option.label}
                        <span className="ml-1.5 text-xs text-slate-400">
                            {(staff[option.type] ?? []).length}
                        </span>
                    </button>
                ))}
            </div>

            {notice?.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {notice.error}
                </p>
            )}

            {notice?.success && (
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
                    <p>{notice.success}</p>
                    {notice.credential && (
                        <p className="mt-1">
                            {notice.credential.label}:{" "}
                            <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                                {notice.credential.value}
                            </code>{" "}
                            <span className="text-emerald-700">
                                — share it in person; it is not stored and cannot be shown again.
                            </span>
                        </p>
                    )}
                </div>
            )}

            <form action={action} className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
                <h2 className="mb-4 text-sm font-semibold">
                    Add {STAFF_LABELS[tab].singular.toLowerCase()}
                </h2>
                <input type="hidden" name="type" value={tab} />

                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-600">Name</span>
                        <input
                            name="name"
                            required
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>

                    {tab === "receptionist" ? (
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-slate-600">Email</span>
                            <input
                                name="email"
                                type="email"
                                required
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                        </label>
                    ) : (
                        <PhoneField name="phone" required key={tab} />
                    )}

                    {tab === "doctor" && (
                        <>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-slate-600">
                                    Email (optional)
                                </span>
                                <input
                                    name="email"
                                    type="email"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-slate-600">
                                    Specialisation
                                </span>
                                <input
                                    name="specialization"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />
                            </label>
                        </>
                    )}
                </div>

                <p className="mt-3 text-xs text-slate-500">
                    A credential is generated and sent over WhatsApp. {active.needs} is required so
                    they can be reached.
                </p>

                <button
                    type="submit"
                    disabled={pending}
                    className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    {pending ? "Adding…" : `Add ${tab}`}
                </button>
            </form>

            {members.length === 0 ? (
                <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
                    No {tab}s yet.
                </p>
            ) : (
                <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Contact</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {members.map((member) => {
                                const activeNow = isActive(member);

                                return (
                                    <tr key={member.id}>
                                        <td className="px-4 py-3">
                                            <div className="font-medium">{member.name}</div>
                                            {member.specialization && (
                                                <div className="text-xs text-slate-400">
                                                    {member.specialization}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">
                                            <div>{member.phone ? displayPhone(member.phone) : "—"}</div>
                                            {member.email && (
                                                <div className="text-xs text-slate-400">{member.email}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`rounded-full px-2 py-1 text-xs font-medium ${
                                                    activeNow
                                                        ? "bg-emerald-50 text-emerald-700"
                                                        : "bg-slate-100 text-slate-500"
                                                }`}
                                            >
                                                {activeNow ? "Active" : "Inactive"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end gap-2">
                                                {tab !== "collector" && (
                                                    <button
                                                        disabled={busy}
                                                        onClick={() =>
                                                            run(() => resetStaffCredential(tab, member.id))
                                                        }
                                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                    >
                                                        Reset {tab === "doctor" ? "PIN" : "password"}
                                                    </button>
                                                )}
                                                <button
                                                    disabled={busy}
                                                    onClick={() =>
                                                        run(() => setStaffActive(tab, member.id, !activeNow))
                                                    }
                                                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                >
                                                    {activeNow ? "Deactivate" : "Reactivate"}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
