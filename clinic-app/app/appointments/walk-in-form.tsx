"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { bookWalkIn, loadSlots, type BookingState } from "./actions";
import { PhoneField } from "@/components/phone-field";

export interface DoctorOption {
    id: string;
    name: string;
    specialization?: string | null;
    availability_status?: string | null;
}

const INITIAL: BookingState = {};

export function WalkInForm({ doctors, date }: { doctors: DoctorOption[]; date: string }) {
    const [open, setOpen] = useState(false);
    const [state, action, pending] = useActionState(bookWalkIn, INITIAL);

    const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
    const [slots, setSlots] = useState<string[]>([]);
    const [loadingSlots, startLoading] = useTransition();

    // Availability depends on the doctor's hours, leave and existing bookings,
    // so it is fetched rather than generated in the browser.
    useEffect(() => {
        if (!open || !doctorId) {
            return;
        }

        startLoading(async () => {
            setSlots(await loadSlots(doctorId, date));
        });
    }, [open, doctorId, date]);

    useEffect(() => {
        if (state.success) {
            setSlots((current) => current.filter((s) => s !== state.success?.match(/at (\d{2}:\d{2})/)?.[1]));
        }
    }, [state.success]);

    if (doctors.length === 0) {
        return (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                No active doctors at this clinic yet, so walk-ins cannot be booked.
            </p>
        );
    }

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
                Book walk-in
            </button>
        );
    }

    return (
        <form
            action={action}
            className="space-y-4 rounded-xl bg-white p-5 ring-1 ring-slate-200"
        >
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Book a walk-in</h2>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-sm text-slate-500 hover:text-slate-700"
                >
                    Close
                </button>
            </div>

            <input type="hidden" name="appointmentDate" value={date} />

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">Patient name</span>
                    <input
                        name="patientName"
                        required
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                </label>

                <PhoneField name="patientPhone" required />

                <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">Doctor</span>
                    <select
                        name="doctorId"
                        value={doctorId}
                        onChange={(e) => setDoctorId(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                        {doctors.map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>
                                {doctor.name}
                                {doctor.specialization ? ` · ${doctor.specialization}` : ""}
                                {doctor.availability_status && doctor.availability_status !== "AVAILABLE"
                                    ? ` (${doctor.availability_status.toLowerCase().replace("_", " ")})`
                                    : ""}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">Time</span>
                    <select
                        name="appointmentTime"
                        required
                        disabled={loadingSlots || slots.length === 0}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                    >
                        {loadingSlots && <option>Loading…</option>}
                        {!loadingSlots && slots.length === 0 && <option value="">No free slots</option>}
                        {!loadingSlots &&
                            slots.map((slot) => (
                                <option key={slot} value={slot}>
                                    {slot}
                                </option>
                            ))}
                    </select>
                </label>
            </div>

            <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">Notes (optional)</span>
                <input
                    name="notes"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
            </label>

            {state.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                </p>
            )}

            {state.success && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                    {state.success}
                </p>
            )}

            <button
                type="submit"
                disabled={pending || slots.length === 0}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
                {pending ? "Booking…" : "Book appointment"}
            </button>
        </form>
    );
}
