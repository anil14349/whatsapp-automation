"use client";

import { useEffect, useState, useTransition } from "react";
import {
    editAppointment,
    loadSlots,
    updateAppointment,
    updateOwnAppointmentStatus,
    type BookingState,
    type ServiceOption
} from "./actions";
import { PhoneField } from "@/components/phone-field";
import { DocumentPanel } from "./document-panel";
import { displayPhone } from "@/lib/phone";
import { useNotice } from "@/lib/use-notice";
import { statusLabel } from "@/lib/labels";

export interface AppointmentRow {
    id: string;
    date: string;
    time: string;
    patientName: string;
    patientPhone: string;
    doctorId: string | null;
    doctorName: string | null;
    serviceTypeId: string | null;
    serviceName: string | null;
    notes: string;
    bookingSource: string | null;
    isRevisit: boolean;
    token: number | null;
    locationType: string | null;
    status: string;
}

/**
 * Blue means booked, green seen, slate did not turn up. Teal is never used
 * here: it belongs to the product and its primary actions, not to what is
 * happening to a patient.
 */
const STATUS_STYLES: Record<string, string> = {
    CONFIRMED: "bg-blue-50 text-blue-700",
    COMPLETED: "bg-green-50 text-green-700",
    NO_SHOW: "bg-slate-100 text-slate-600",
    CANCELLED: "bg-slate-50 text-slate-400"
};

const STATUS_DOTS: Record<string, string> = {
    CONFIRMED: "bg-blue-600",
    COMPLETED: "bg-green-600",
    NO_SHOW: "bg-slate-500",
    CANCELLED: "bg-slate-300"
};

/** Neutral by default; colour is spent only where it means something. */
const BUTTON = {
    plain: "rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50",
    good: "rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition hover:border-green-300 hover:bg-green-100 disabled:opacity-50",
    quiet: "rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50",
    danger: "w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50",
    menuItem:
        "w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
};

/** Postgres hands back "10:00:00" and the clock on the wall does not. */
function clockTime(time: string): string {
    return String(time ?? "").slice(0, 5);
}

/**
 * The actions the desk needs occasionally, folded away.
 *
 * Closes on any outside click, because a menu left open over the next row is
 * worse than one that closes too eagerly.
 */
function RowMenu({
    open,
    onToggle,
    children
}: {
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    useEffect(() => {
        if (!open) return;

        const close = () => onToggle();
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [open, onToggle]);

    return (
        <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
                onClick={onToggle}
                aria-label="More actions"
                aria-expanded={open}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold leading-none text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
            >
                •••
            </button>

            {open && (
                <div className="absolute right-0 top-8 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    {children}
                </div>
            )}
        </div>
    );
}

export function AppointmentTable({
    rows,
    date,
    showDoctor,
    canEdit,
    isDoctor = false,
    doctors = [],
    services = [],
    showDate = false
}: {
    rows: AppointmentRow[];
    date: string;
    showDoctor: boolean;
    canEdit: boolean;
    isDoctor?: boolean;
    doctors?: Array<{ id: string; name: string }>;
    services?: ServiceOption[];
    /** Search results span every date, so the day stops being implied. */
    showDate?: boolean;
}) {
    const [notice, setNotice] = useNotice<BookingState>({});
    const [busy, start] = useTransition();
    const [moving, setMoving] = useState<AppointmentRow | null>(null);
    const [editing, setEditing] = useState<AppointmentRow | null>(null);
    const [sending, setSending] = useState<AppointmentRow | null>(null);
    const [slots, setSlots] = useState<string[]>([]);
    const [newDate, setNewDate] = useState(date);
    const [place, setPlace] = useState<"ALL" | "CLINIC" | "HOME">("ALL");
    const [menu, setMenu] = useState<string | null>(null);

    const counts = {
        home: rows.filter((r) => r.locationType === "HOME").length,
        clinic: rows.filter((r) => r.locationType !== "HOME").length
    };

    const shown =
        place === "ALL"
            ? rows
            : rows.filter((r) => (place === "HOME" ? r.locationType === "HOME" : r.locationType !== "HOME"));

    function run(fn: () => Promise<BookingState>) {
        start(async () => setNotice(await fn()));
    }

    function beginMove(row: AppointmentRow) {
        setMoving(row);
        setEditing(null);
        setSending(null);
        setNotice({});

        // In a search the page has no single day, so the row carries its own.
        const from = row.date || date;

        setNewDate(from);

        if (row.doctorId) {
            start(async () => setSlots(await loadSlots(row.doctorId!, from)));
        }
    }

    function beginEdit(row: AppointmentRow) {
        setEditing(row);
        setMoving(null);
        setSending(null);
        setNotice({});
    }

    function beginSend(row: AppointmentRow) {
        setSending(row);
        setEditing(null);
        setMoving(null);
        setNotice({});
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
                            className="ml-auto rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                        >
                            Move appointment
                        </button>
                    </div>
                </div>
            )}

            {editing && (
                <EditPanel
                    key={editing.id}
                    row={editing}
                    doctors={doctors}
                    services={services}
                    busy={busy}
                    onClose={() => setEditing(null)}
                    onSave={(fields) =>
                        run(async () => {
                            const result = await editAppointment(editing.id, fields);
                            if (!result.error) setEditing(null);
                            return result;
                        })
                    }
                />
            )}

            {sending && (
                <DocumentPanel
                    key={sending.id}
                    appointmentId={sending.id}
                    patientName={sending.patientName}
                    onClose={() => setSending(null)}
                />
            )}

            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                {counts.home > 0 && counts.clinic > 0 && (
                    /* Home visits and clinic visits are different work. Only
                       offered when the day actually holds both. */
                    <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
                        {(
                            [
                                ["ALL", `All ${rows.length}`],
                                ["CLINIC", `At the clinic ${counts.clinic}`],
                                ["HOME", `Home visits ${counts.home}`]
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => setPlace(value)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                    place === value
                                        ? "bg-white text-slate-900 ring-1 ring-slate-200"
                                        : "text-slate-500 hover:text-slate-900"
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}

                <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                            <th className="px-4 py-3 text-right">#</th>
                            {showDate && <th className="px-4 py-3">Date</th>}
                            <th className="px-4 py-3">Time</th>
                            <th className="px-4 py-3">Patient</th>
                            <th className="px-4 py-3">For</th>
                            {showDoctor && <th className="px-4 py-3">Doctor</th>}
                            <th className="px-4 py-3">Status</th>
                            {(canEdit || isDoctor) && <th className="px-4 py-3 text-right">Actions</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {shown.map((row, index) => {
                            const open = row.status === "CONFIRMED";

                            return (
                                <tr key={row.id}>
                                    <td className="px-4 py-3 text-right text-slate-400 tabular-nums">
                                        {index + 1}
                                    </td>
                                    {showDate && (
                                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums">
                                            {row.date}
                                        </td>
                                    )}
                                    <td className="px-4 py-3 whitespace-nowrap text-base font-semibold text-slate-900 tabular-nums">
                                        {clockTime(row.time)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-slate-900">
                                                {row.patientName}
                                            </span>
                                            {/* The clinic queue number, which only visits to
                                                the clinic itself are given. */}
                                            {row.token !== null && (
                                                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[11px] font-semibold text-white tabular-nums">
                                                    {row.token}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500 tabular-nums">
                                            {displayPhone(row.patientPhone)}
                                        </div>
                                        {/* The front desk should not have to remember who is
                                            returning within the clinic's free window. */}
                                        {row.isRevisit && (
                                            <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                                                revisit
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-slate-600">{row.serviceName ?? "—"}</div>
                                        <div className="flex gap-1.5 text-xs text-slate-400">
                                            {/* Deliberately not teal: that belongs to the product
                                                and its primary actions, not to a fact about a visit. */}
                                            {row.locationType === "HOME" && (
                                                <span className="font-medium text-slate-600">
                                                    at home
                                                </span>
                                            )}
                                            {/* A walk-in has had no confirmation message, unlike
                                                a patient who booked themselves. */}
                                            {row.bookingSource === "WALK_IN" && <span>walk-in</span>}
                                        </div>
                                    </td>
                                    {showDoctor && (
                                        <td className="px-4 py-3 text-slate-600">
                                            {row.doctorName ?? (
                                                <span className="text-slate-400">no doctor needed</span>
                                            )}
                                        </td>
                                    )}
                                    <td className="px-4 py-3">
                                        <span
                                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                                                STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                                            }`}
                                        >
                                            <span
                                                className={`h-1.5 w-1.5 rounded-full ${
                                                    STATUS_DOTS[row.status] ?? "bg-slate-400"
                                                }`}
                                            />
                                            {statusLabel(row.status)}
                                        </span>
                                    </td>
                                    {canEdit && (
                                        <td className="px-4 py-3">
                                            {/* Only what the desk reaches for all day stays on
                                                the row; six equal buttons read as noise. */}
                                            <div className="flex items-center justify-end gap-1.5">
                                                {open && (
                                                    <button
                                                        disabled={busy}
                                                        onClick={() =>
                                                            run(() =>
                                                                updateAppointment(row.id, "status", {
                                                                    status: "COMPLETED"
                                                                })
                                                            )
                                                        }
                                                        className={BUTTON.good}
                                                    >
                                                        Visited
                                                    </button>
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
                                                        className={BUTTON.plain}
                                                    >
                                                        Reopen
                                                    </button>
                                                )}
                                                {/* A result can follow a visit that was completed
                                                    days ago, so this is not tied to the open state. */}
                                                {row.status !== "CANCELLED" && (
                                                    <button
                                                        disabled={busy}
                                                        onClick={() => beginSend(row)}
                                                        className={BUTTON.plain}
                                                    >
                                                        Send report
                                                    </button>
                                                )}
                                                {row.status !== "CANCELLED" && (
                                                    <RowMenu
                                                        open={menu === row.id}
                                                        onToggle={() =>
                                                            setMenu(menu === row.id ? null : row.id)
                                                        }
                                                    >
                                                        {/* A name can be spelt wrong whether or not
                                                            the patient has already been seen. */}
                                                        <button
                                                            disabled={busy}
                                                            onClick={() => {
                                                                setMenu(null);
                                                                beginEdit(row);
                                                            }}
                                                            className={BUTTON.menuItem}
                                                        >
                                                            Edit details
                                                        </button>
                                                        {open && (
                                                            <>
                                                                <button
                                                                    disabled={busy || !row.doctorId}
                                                                    onClick={() => {
                                                                        setMenu(null);
                                                                        beginMove(row);
                                                                    }}
                                                                    className={BUTTON.menuItem}
                                                                >
                                                                    Move to another time
                                                                </button>
                                                                <button
                                                                    disabled={busy}
                                                                    onClick={() => {
                                                                        setMenu(null);
                                                                        run(() =>
                                                                            updateAppointment(
                                                                                row.id,
                                                                                "status",
                                                                                { status: "NO_SHOW" }
                                                                            )
                                                                        );
                                                                    }}
                                                                    className={BUTTON.menuItem}
                                                                >
                                                                    Did not turn up
                                                                </button>
                                                                <button
                                                                    disabled={busy}
                                                                    onClick={() => {
                                                                        setMenu(null);
                                                                        run(() =>
                                                                            updateAppointment(
                                                                                row.id,
                                                                                "cancel"
                                                                            )
                                                                        );
                                                                    }}
                                                                    className={BUTTON.danger}
                                                                >
                                                                    Cancel appointment
                                                                </button>
                                                            </>
                                                        )}
                                                    </RowMenu>
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
                                                            className={BUTTON.good}
                                                        >
                                                            Visited
                                                        </button>
                                                        <button
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(() =>
                                                                    updateOwnAppointmentStatus(row.id, "NO_SHOW")
                                                                )
                                                            }
                                                            className={BUTTON.quiet}
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

/**
 * Correcting what the front desk wrote down. Date and time are the Move action,
 * because changing those has to be checked against free slots.
 */
function EditPanel({
    row,
    doctors,
    services,
    busy,
    onClose,
    onSave
}: {
    row: AppointmentRow;
    doctors: Array<{ id: string; name: string }>;
    services: ServiceOption[];
    busy: boolean;
    onClose: () => void;
    onSave: (fields: {
        patientName: string;
        patientPhone: string;
        notes: string;
        doctorId: string | null;
        serviceTypeId: string;
    }) => void;
}) {
    const [patientName, setPatientName] = useState(row.patientName);
    const [patientPhone, setPatientPhone] = useState(row.patientPhone);
    const [notes, setNotes] = useState(row.notes);
    const [doctorId, setDoctorId] = useState(row.doctorId ?? "");
    const [serviceTypeId, setServiceTypeId] = useState(row.serviceTypeId ?? "");

    const service = services.find((s) => s.serviceTypeId === serviceTypeId);
    const needsDoctor = service ? service.requiresDoctor : true;
    const phoneChanged = patientPhone.replace(/\D/g, "") !== row.patientPhone;

    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                    Edit {row.patientName} ({row.time})
                </h3>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
                    Close
                </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Patient name</span>
                    <input
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                </label>

                <PhoneField
                    defaultValue={row.patientPhone}
                    onChange={setPatientPhone}
                >
                    {phoneChanged && (
                        <span className="block text-xs text-amber-700">
                            Reminders for this appointment will go to the new number.
                        </span>
                    )}
                </PhoneField>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">For</span>
                    <select
                        value={serviceTypeId}
                        onChange={(e) => setServiceTypeId(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                        {services.length === 0 && <option value={serviceTypeId}>{row.serviceName}</option>}
                        {services.map((s) => (
                            <option key={s.serviceTypeId} value={s.serviceTypeId}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Doctor</span>
                    <select
                        value={doctorId}
                        onChange={(e) => setDoctorId(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                        <option value="">{needsDoctor ? "Choose a doctor" : "No doctor needed"}</option>
                        {doctors.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.name}
                            </option>
                        ))}
                    </select>
                    {doctorId !== (row.doctorId ?? "") && doctorId && (
                        <span className="block text-xs text-slate-500">
                            Checked against that doctor&apos;s free slots at {row.time}.
                        </span>
                    )}
                </label>

                <div className="sm:col-span-2">
                    <label className="space-y-1">
                        <span className="block text-xs font-medium text-slate-600">Notes</span>
                        <input
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>
                </div>
            </div>

            <div className="mt-4 flex justify-end">
                <button
                    disabled={busy}
                    onClick={() =>
                        onSave({
                            patientName,
                            patientPhone,
                            notes,
                            doctorId: doctorId || null,
                            serviceTypeId
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
