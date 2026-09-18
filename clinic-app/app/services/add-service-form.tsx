"use client";

import { useActionState, useEffect, useState } from "react";
import { createService, type ServiceState } from "./actions";
import { useAutoDismiss } from "@/lib/use-notice";

const CATEGORIES = ["CONSULTATION", "DIAGNOSTIC", "IMAGING", "VACCINE", "OTHER"];

export function AddServiceForm({ title, summary }: { title: string; summary: string }) {
    const [state, action, pending] = useActionState<ServiceState, FormData>(createService, {});
    const [open, setOpen] = useState(false);
    const showAdded = useAutoDismiss(state);

    // Adding a service is occasional; the list is what the page is for.
    useEffect(() => {
        if (state.success) {
            setOpen(false);
        }
    }, [state.success]);

    // The heading lives here so the trigger can sit on the same line as it
    // rather than on a row of its own above the list.
    const header = (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 className="text-xl font-semibold">{title}</h1>
                <p className="text-sm text-slate-500">{summary}</p>
            </div>
            <button
                onClick={() => setOpen(!open)}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
                Add a service
            </button>
        </div>
    );

    if (!open) {
        return (
            <>
                {header}
                {state.success && showAdded && (
                    <p className="mb-4 text-sm text-emerald-700" role="status">
                        {state.success}
                    </p>
                )}
            </>
        );
    }

    return (
        <>
            {header}
            <form action={action} className="mb-4 rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <div className="mb-1 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Add a service</h2>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="text-sm text-slate-500 hover:text-slate-700"
                    >
                        Close
                    </button>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                    Only this clinic will see it. It stays off until you switch it on.
            </p>

            <div className="grid gap-3 sm:grid-cols-4">
                <label className="space-y-1 sm:col-span-2">
                    <span className="block text-xs font-medium text-slate-600">Name</span>
                    <input
                        name="name"
                        required
                        maxLength={24}
                        placeholder="MRI Scan"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                    <span className="block text-xs text-slate-500">
                        Up to 24 characters, so it fits on a patient&apos;s phone
                    </span>
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Type</span>
                    <select
                        name="category"
                        defaultValue="DIAGNOSTIC"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                                {c.charAt(0) + c.slice(1).toLowerCase()}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Minutes</span>
                    <input
                        name="durationMinutes"
                        type="number"
                        min="1"
                        defaultValue={30}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Price (₹)</span>
                    <input
                        name="clinicPrice"
                        type="number"
                        min="0"
                        placeholder="optional"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>
            </div>

                {/* Outside the grid: inside it the button sat at the edge of a
                    quarter-width cell rather than the edge of the card. */}
                <div className="mt-4 flex justify-end">
                    <button
                        disabled={pending}
                        className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                    >
                        {pending ? "Adding…" : "Add"}
                    </button>
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
            </form>
        </>
    );
}
