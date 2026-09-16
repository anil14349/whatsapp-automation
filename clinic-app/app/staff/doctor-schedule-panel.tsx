"use client";

import { useEffect, useState, useTransition } from "react";
import {
    addDoctorLeave,
    cancelDoctorLeave,
    loadDoctorSchedule,
    saveDoctorHours,
    type DoctorDay,
    type DoctorLeave,
    type StaffState
} from "./actions";
import { useNotice } from "@/lib/use-notice";

/**
 * Consulting hours and leave for one doctor.
 *
 * These decide the slots patients are offered, and until now only the doctor
 * could set them, from their own WhatsApp menu.
 */
export function DoctorSchedulePanel({
    doctorId,
    doctorName,
    onClose
}: {
    doctorId: string;
    doctorName: string;
    onClose: () => void;
}) {
    const [hours, setHours] = useState<DoctorDay[]>([]);
    const [leaves, setLeaves] = useState<DoctorLeave[]>([]);
    const [notice, setNotice] = useNotice<StaffState>({});
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<"consulting" | "visiting">("consulting");
    const [busy, start] = useTransition();

    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [reason, setReason] = useState("");

    function refresh() {
        start(async () => {
            const result = await loadDoctorSchedule(doctorId);
            setHours(result.hours);
            setLeaves(result.leaves);
            if (result.error) setNotice({ error: result.error });
            setLoading(false);
        });
    }

    useEffect(refresh, [doctorId]);

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Hours and leave · {doctorName}</h2>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
                    Close
                </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
                These decide the times patients are offered. The clinic&apos;s own opening hours
                still apply on top.
            </p>

            {(notice.error || notice.success) && (
                <p
                    className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                        notice.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}
                    role={notice.error ? "alert" : "status"}
                >
                    {notice.error ?? notice.success}
                </p>
            )}

            {loading ? (
                <p className="text-sm text-slate-500">Loading…</p>
            ) : (
                <>
                    <div className="mb-3 flex gap-2">
                        {(["consulting", "visiting"] as const).map((option) => (
                            <button
                                key={option}
                                onClick={() => setMode(option)}
                                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                                    mode === option
                                        ? "border-brand-500 bg-brand-50 text-brand-700"
                                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                                }`}
                            >
                                {option === "consulting" ? "At the clinic" : "Home visits"}
                            </button>
                        ))}
                    </div>

                    <p className="mb-3 text-xs text-slate-500">
                        {mode === "consulting"
                            ? "Slots at the clinic, trimmed to the clinic's own opening hours."
                            : "Hours this doctor spends visiting patients at home. Kept separately, and not limited by the clinic's opening hours — the doctor is out."}
                    </p>

                    <div className="space-y-2">
                        {hours.map((day) => (
                            <DayRow
                                key={`${mode}-${day.dayOfWeek}`}
                                day={day}
                                mode={mode}
                                disabled={busy}
                                onSave={(open, close, on) =>
                                    start(async () => {
                                        setNotice(
                                            await saveDoctorHours(
                                                doctorId,
                                                day.dayOfWeek,
                                                open,
                                                close,
                                                on,
                                                mode === "visiting"
                                            )
                                        );
                                        refresh();
                                    })
                                }
                            />
                        ))}
                    </div>
                </>
            )}

            <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="mb-1 text-sm font-semibold">Leave</h3>
                <p className="mb-3 text-xs text-slate-500">
                    No slots are offered on these days.
                </p>

                <div className="mb-3 flex flex-wrap items-end gap-3">
                    <label className="space-y-1">
                        <span className="block text-xs font-medium text-slate-600">From</span>
                        <input
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="block text-xs font-medium text-slate-600">
                            To (same day if blank)
                        </span>
                        <input
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="block text-xs font-medium text-slate-600">Reason</span>
                        <input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Conference"
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                        />
                    </label>
                    <button
                        disabled={busy}
                        onClick={() =>
                            start(async () => {
                                setNotice(await addDoctorLeave(doctorId, from, to, reason));
                                setFrom("");
                                setTo("");
                                setReason("");
                                refresh();
                            })
                        }
                        className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-slate-300 disabled:opacity-60"
                    >
                        Record leave
                    </button>
                </div>

                {leaves.length === 0 ? (
                    <p className="text-sm text-slate-500">No leave coming up.</p>
                ) : (
                    <div className="space-y-2">
                        {leaves.map((leave) => (
                            <div
                                key={leave.id}
                                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                            >
                                <div className="text-sm">
                                    <span className="font-medium">
                                        {leave.leave_start_date}
                                        {leave.leave_end_date !== leave.leave_start_date &&
                                            ` to ${leave.leave_end_date}`}
                                    </span>
                                    {leave.reason && (
                                        <span className="ml-2 text-slate-500">{leave.reason}</span>
                                    )}
                                </div>
                                <button
                                    disabled={busy}
                                    onClick={() =>
                                        start(async () => {
                                            setNotice(await cancelDoctorLeave(doctorId, leave.id));
                                            refresh();
                                        })
                                    }
                                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function DayRow({
    day,
    mode,
    disabled,
    onSave
}: {
    day: DoctorDay;
    mode: "consulting" | "visiting";
    disabled: boolean;
    onSave: (open: string, close: string, on: boolean) => void;
}) {
    const visiting = mode === "visiting";

    const savedOn = visiting ? day.visiting : day.working;
    const savedOpen = visiting ? day.visitOpenTime : day.openTime;
    const savedClose = visiting ? day.visitCloseTime : day.closeTime;

    // A day that is off is stored as 00:00-00:00, which would be rejected the
    // moment someone ticks the box, so offer a sensible default instead.
    const [open, setOpen] = useState(savedOn ? (savedOpen ?? "09:00") : visiting ? "14:00" : "09:00");
    const [close, setClose] = useState(savedOn ? (savedClose ?? "17:00") : visiting ? "18:00" : "17:00");
    const [on, setOn] = useState(savedOn);

    const changed = on !== savedOn || (on && (open !== savedOpen || close !== savedClose));

    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
            <span className="w-24 text-sm font-medium">{day.label}</span>

            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={(e) => setOn(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-slate-500">{visiting ? "Visiting" : "Consulting"}</span>
            </label>

            <input
                type="time"
                value={open}
                disabled={disabled || !on}
                onChange={(e) => setOpen(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />
            <span className="text-slate-400">to</span>
            <input
                type="time"
                value={close}
                disabled={disabled || !on}
                onChange={(e) => setClose(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />

            {changed && (
                <button
                    disabled={disabled}
                    onClick={() => onSave(open, close, on)}
                    className="ml-auto rounded-lg bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    Save
                </button>
            )}
        </div>
    );
}
