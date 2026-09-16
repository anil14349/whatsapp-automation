"use client";

import { useActionState } from "react";
import { saveDetails, addClosure, type ClinicDetails, type SettingsState } from "./actions";
import { TimezoneField } from "./timezone-field";

export function DetailsForm({ clinic }: { clinic: ClinicDetails }) {
    const [state, action, pending] = useActionState<SettingsState, FormData>(saveDetails, {});

    return (
        <form action={action} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-semibold">Clinic details</h2>

            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" name="name" defaultValue={clinic.name} required />
                <Field label="Phone" name="phone" defaultValue={clinic.phone ?? ""} />
                <Field label="Email" name="email" type="email" defaultValue={clinic.email ?? ""} />
                <Field label="City" name="city" defaultValue={clinic.city ?? ""} />

                <div className="sm:col-span-2">
                    <Field label="Address" name="address" defaultValue={clinic.address ?? ""} />
                </div>

                <TimezoneField value={clinic.timezone} />
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">
                        Revisit window (days)
                    </span>
                    <input
                        name="revisitWindowDays"
                        type="number"
                        min={0}
                        max={365}
                        defaultValue={clinic.revisitWindowDays}
                        className="w-32 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                    <span className="block text-xs text-slate-400">
                        A patient returning to the same doctor within this many days is marked a
                        revisit. Zero switches it off.
                    </span>
                </label>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        name="afterHoursReply"
                        defaultChecked={clinic.afterHoursReply}
                        className="h-4 w-4 rounded border-slate-300"
                    />
                    <span>Reply automatically when a patient messages out of hours</span>
                </label>

                <div className="mt-2">
                    <Field
                        label="Out of hours message"
                        name="afterHoursMessage"
                        defaultValue={clinic.afterHoursMessage ?? ""}
                    />
                </div>
            </div>

            {state.error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                </p>
            )}
            {state.success && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                    {state.success}
                </p>
            )}

            <button
                disabled={pending}
                className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
                {pending ? "Saving…" : "Save details"}
            </button>
        </form>
    );
}

export function AddClosureForm() {
    const [state, action, pending] = useActionState<SettingsState, FormData>(addClosure, {});

    return (
        <form action={action} className="mb-3 flex flex-wrap items-end gap-3">
            <label className="space-y-1">
                <span className="block text-xs font-medium text-slate-600">Date</span>
                <input
                    type="date"
                    name="date"
                    required
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
            </label>

            <label className="space-y-1">
                <span className="block text-xs font-medium text-slate-600">Reason</span>
                <input
                    name="name"
                    placeholder="Public holiday"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
            </label>

            <button
                disabled={pending}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-slate-300 disabled:opacity-60"
            >
                {pending ? "Adding…" : "Close this day"}
            </button>

            {state.error && (
                <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                </p>
            )}
            {state.success && (
                <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                    {state.success}
                </p>
            )}
        </form>
    );
}

function Field({
    label,
    name,
    defaultValue,
    type = "text",
    required = false
}: {
    label: string;
    name: string;
    defaultValue: string;
    type?: string;
    required?: boolean;
}) {
    return (
        <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">{label}</span>
            <input
                name={name}
                type={type}
                defaultValue={defaultValue}
                required={required}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
        </label>
    );
}
