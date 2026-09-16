"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
    createStaff,
    editStaff,
    removeStaff,
    resetStaffCredential,
    setStaffActive,
    type StaffEdit,
    type StaffState,
    type StaffType
} from "./actions";
import { STAFF_LABELS } from "@/lib/labels";
import { PhoneField } from "@/components/phone-field";
import { displayPhone } from "@/lib/phone";
import { DoctorSchedulePanel } from "./doctor-schedule-panel";
import { useNotice } from "@/lib/use-notice";

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
    { type: "doctor", label: STAFF_LABELS.doctor.plural, needs: "A WhatsApp number" },
    { type: "receptionist", label: STAFF_LABELS.receptionist.plural, needs: "A WhatsApp number or an email" },
    { type: "collector", label: STAFF_LABELS.collector.plural, needs: "A WhatsApp number" }
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
    const [rowState, setRowState] = useNotice<StaffState>({});
    const [editing, setEditing] = useState<StaffMember | null>(null);
    const [removing, setRemoving] = useState<StaffMember | null>(null);
    const [scheduling, setScheduling] = useState<StaffMember | null>(null);
    const [adding, setAdding] = useState(false);
    const [busy, startAction] = useTransition();

    const members = staff[tab] ?? [];
    const active = TABS.find((t) => t.type === tab)!;

    function run(fn: () => Promise<StaffState>) {
        startAction(async () => setRowState(await fn()));
    }

    const notice = rowState.error || rowState.success ? rowState : state;

    // The credential is shown in the notice above, so leaving the form open
    // would hide the one thing that has to be read.
    useEffect(() => {
        if (state.success) {
            setAdding(false);
        }
    }, [state.success]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                    {TABS.map((option) => (
                        <button
                            key={option.type}
                            onClick={() => {
                                setTab(option.type);
                                setRowState({});
                                setEditing(null);
                                setRemoving(null);
                                setScheduling(null);
                                setAdding(false);
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

                <button
                    onClick={() => {
                        setAdding(!adding);
                        setEditing(null);
                        setScheduling(null);
                    }}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                    Add {STAFF_LABELS[tab].singular.toLowerCase()}
                </button>
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

            {removing && (
                <div className="rounded-xl bg-white p-4 ring-1 ring-red-200">
                    <p className="text-sm">
                        Remove <strong>{removing.name}</strong>? This cannot be undone. Deactivating
                        keeps the record and the history.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            onClick={() => setRemoving(null)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-slate-300"
                        >
                            Keep
                        </button>
                        <button
                            disabled={busy}
                            onClick={() => {
                                const target = removing;
                                setRemoving(null);
                                run(() => removeStaff(tab, target.id));
                            }}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                        >
                            Remove for good
                        </button>
                    </div>
                </div>
            )}

            {scheduling && (
                <DoctorSchedulePanel
                    key={scheduling.id}
                    doctorId={scheduling.id}
                    doctorName={scheduling.name}
                    onClose={() => setScheduling(null)}
                />
            )}

            {editing && (
                <EditStaffPanel
                    key={editing.id}
                    type={tab}
                    member={editing}
                    busy={busy}
                    onClose={() => setEditing(null)}
                    onSave={(fields) =>
                        startAction(async () => {
                            const result = await editStaff(tab, editing.id, fields);
                            setRowState(result);
                            if (!result.error) setEditing(null);
                        })
                    }
                />
            )}

            {adding && (
                <form action={action} className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                        Add {STAFF_LABELS[tab].singular.toLowerCase()}
                    </h2>
                    <button
                        type="button"
                        onClick={() => setAdding(false)}
                        className="text-sm text-slate-500 hover:text-slate-700"
                    >
                        Close
                    </button>
                </div>
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
                        <>
                            <PhoneField
                                name="phone"
                                key={tab}
                                hint="They can sign in with this"
                            />
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-slate-600">
                                    Email (optional)
                                </span>
                                <input
                                    name="email"
                                    type="email"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />
                                <span className="block text-xs text-slate-400">
                                    Needed only if they have no WhatsApp number
                                </span>
                            </label>
                        </>
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
                    A credential is generated and sent to them. {active.needs} is required so they
                    can be reached.
                </p>

                <div className="mt-4 flex justify-end">
                    <button
                        type="submit"
                        disabled={pending}
                        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                    >
                        {pending ? "Adding…" : `Add ${STAFF_LABELS[tab].singular.toLowerCase()}`}
                    </button>
                </div>
                </form>
            )}

            {members.length === 0 ? (
                <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
                    No {STAFF_LABELS[tab].plural.toLowerCase()} yet.
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
                                            <div className="flex flex-wrap justify-end gap-2">
                                                {tab === "doctor" && (
                                                    <button
                                                        disabled={busy}
                                                        onClick={() => {
                                                            setScheduling(member);
                                                            setEditing(null);
                                                            setRowState({});
                                                        }}
                                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                    >
                                                        Hours
                                                    </button>
                                                )}
                                                <button
                                                    disabled={busy}
                                                    onClick={() => {
                                                        setEditing(member);
                                                        setScheduling(null);
                                                        setRowState({});
                                                    }}
                                                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                                >
                                                    Edit
                                                </button>
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
                                                <button
                                                    disabled={busy}
                                                    onClick={() => setRemoving(member)}
                                                    className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:border-red-300 disabled:opacity-50"
                                                >
                                                    Remove
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

function EditStaffPanel({
    type,
    member,
    busy,
    onClose,
    onSave
}: {
    type: StaffType;
    member: StaffMember;
    busy: boolean;
    onClose: () => void;
    onSave: (fields: StaffEdit) => void;
}) {
    const [name, setName] = useState(member.name);
    const [phone, setPhone] = useState(member.phone ?? "");
    const [email, setEmail] = useState(member.email ?? "");
    const [specialization, setSpecialization] = useState(member.specialization ?? "");
    const [maxPerDay, setMaxPerDay] = useState(member.max_collections_per_day ?? 8);

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Edit {member.name}</h2>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
                    Close
                </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">Name</span>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                </label>

                <PhoneField
                    defaultValue={member.phone ?? ""}
                    onChange={setPhone}
                    hint={
                        type === "doctor"
                            ? "This is how the bot recognises them on WhatsApp"
                            : undefined
                    }
                />

                <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">
                        Email{type === "receptionist" ? "" : " (optional)"}
                    </span>
                    <input
                        value={email}
                        type="email"
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                    {type === "receptionist" && (
                        <span className="block text-xs text-slate-400">They sign in with this</span>
                    )}
                </label>

                {type === "doctor" && (
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-600">Specialisation</span>
                        <input
                            value={specialization}
                            onChange={(e) => setSpecialization(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>
                )}

                {type === "collector" && (
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-600">
                            Collections per day
                        </span>
                        <input
                            type="number"
                            min={1}
                            value={maxPerDay}
                            onChange={(e) => setMaxPerDay(Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>
                )}
            </div>

            <div className="mt-4 flex justify-end">
                <button
                    disabled={busy}
                    onClick={() =>
                        onSave({
                            name,
                            phone,
                            email,
                            ...(type === "doctor" ? { specialization } : {}),
                            ...(type === "collector" ? { maxCollectionsPerDay: maxPerDay } : {})
                        })
                    }
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    {busy ? "Saving…" : "Save changes"}
                </button>
            </div>
        </div>
    );
}
