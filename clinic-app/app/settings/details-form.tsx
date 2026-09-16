"use client";

import { useActionState, useState } from "react";
import { saveDetails, addClosure, type ClinicDetails, type SettingsState } from "./actions";
import { TimezoneField } from "./timezone-field";
import { readableOn } from "@/lib/theme";
import { useAutoDismiss } from "@/lib/use-notice";

export function DetailsForm({ clinic }: { clinic: ClinicDetails }) {
    const [state, action, pending] = useActionState<SettingsState, FormData>(saveDetails, {});
    const showSaved = useAutoDismiss(state.success);

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
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Appearance
                </h3>
                <BrandingFields logoUrl={clinic.logoUrl} brandColour={clinic.brandColour} />
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
            {state.success && showSaved && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                    {state.success}
                </p>
            )}

            <div className="mt-4 flex justify-end">
                <button
                    disabled={pending}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    {pending ? "Saving…" : "Save details"}
                </button>
            </div>
        </form>
    );
}

export function AddClosureForm() {
    const [state, action, pending] = useActionState<SettingsState, FormData>(addClosure, {});
    const showAdded = useAutoDismiss(state.success, 8000);

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
                className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-slate-300 disabled:opacity-60"
            >
                {pending ? "Adding…" : "Close this day"}
            </button>

            {state.error && (
                <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                </p>
            )}
            {state.success && showAdded && (
                <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                    {state.success}
                </p>
            )}
        </form>
    );
}

/**
 * The logo and colour, shown as they will actually appear.
 *
 * A hex field on its own gives no idea what the header will look like, and a
 * pale colour with white text on it is only obvious once you see it.
 */
function BrandingFields({
    logoUrl,
    brandColour
}: {
    logoUrl: string | null;
    brandColour: string | null;
}) {
    const [logo, setLogo] = useState(logoUrl ?? "");
    const [colour, setColour] = useState(brandColour ?? "");

    const valid = /^#[0-9a-f]{6}$/i.test(colour);
    const preview = valid ? colour : "#0f766e";

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium text-slate-600">Logo address</span>
                <input
                    name="logoUrl"
                    value={logo}
                    onChange={(e) => setLogo(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
                <span className="block text-xs text-slate-400">
                    Leave blank to show the clinic&apos;s initials instead.
                </span>
            </label>

            <label className="space-y-1">
                <span className="block text-xs font-medium text-slate-600">Colour</span>
                <div className="flex items-center gap-2">
                    <input
                        type="color"
                        value={preview}
                        onChange={(e) => setColour(e.target.value)}
                        aria-label="Pick a colour"
                        className="h-9 w-12 cursor-pointer rounded border border-slate-200"
                    />
                    <input
                        name="brandColour"
                        value={colour}
                        onChange={(e) => setColour(e.target.value)}
                        placeholder="#0f766e"
                        className="w-32 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </div>
                {colour && !valid && (
                    <span className="block text-xs text-amber-700">
                        Needs to look like #0f766e
                    </span>
                )}
            </label>

            <div className="space-y-1">
                <span className="block text-xs font-medium text-slate-600">Preview</span>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                    {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain" />
                    ) : (
                        <span
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold"
                            style={{ backgroundColor: preview, color: readableOn(preview) }}
                        >
                            CL
                        </span>
                    )}
                    <button
                        type="button"
                        className="rounded-lg px-3 py-1.5 text-sm font-medium"
                        style={{ backgroundColor: preview, color: readableOn(preview) }}
                    >
                        Button
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({
    label,
    name,
    defaultValue,
    type = "text",
    required = false
}: {    label: string;
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
