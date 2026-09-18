"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import {
    saveDetails,
    addClosure,
    uploadLogo,
    removeLogo,
    type ClinicDetails,
    type SettingsState
} from "./actions";
import { TimezoneField } from "./timezone-field";
import { readableOn } from "@/lib/theme";
import { parseCoordinates } from "@/lib/coords";
import { useAutoDismiss } from "@/lib/use-notice";
import { PhoneField } from "@/components/phone-field";

/**
 * One section, one form, one Save.
 *
 * Settings was a single form covering everything from the clinic's name to the
 * out-of-hours reply, so every save rewrote every field and the page could only
 * ever be one long scroll.
 */
function Section({
    clinic,
    title,
    description,
    children
}: {
    clinic: ClinicDetails;
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    const [state, action, pending] = useActionState<SettingsState, FormData>(saveDetails, {});
    const showSaved = useAutoDismiss(state);

    return (
        <form action={action} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 mb-3 text-xs text-slate-500">{description}</p>}

            {/* React resets an uncontrolled form once the action returns, back to
                the values it mounted with, so a saved change appeared to have
                been thrown away. Keying the fields alone remounts them with the
                saved values while the form keeps the "Saved." it just produced -
                keying the form threw that away exactly when it was earned. */}
            <div key={JSON.stringify(clinic)} className={description ? "" : "mt-3"}>
                {children}
            </div>

            {state.error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                </p>
            )}
            {state.success && showSaved && (
                <p
                    className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                    role="status"
                >
                    {state.success}
                </p>
            )}

            <div className="mt-4 flex justify-end">
                <button
                    disabled={pending}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    {pending ? "Saving…" : "Save changes"}
                </button>
            </div>
        </form>
    );
}

export function GeneralForm({ clinic }: { clinic: ClinicDetails }) {
    return (
        <Section clinic={clinic} title="Clinic details">
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" name="name" defaultValue={clinic.name} required />
                <PhoneField name="phone" label="Phone" defaultValue={clinic.phone ?? ""} />
                <Field label="Email" name="email" type="email" defaultValue={clinic.email ?? ""} />
                <Field label="City" name="city" defaultValue={clinic.city ?? ""} />

                <div className="sm:col-span-2">
                    <Field label="Address" name="address" defaultValue={clinic.address ?? ""} />
                </div>

                <TimezoneField value={clinic.timezone} />
            </div>
        </Section>
    );
}

export function BrandingForm({ clinic }: { clinic: ClinicDetails }) {
    return (
        <Section
            clinic={clinic}
            title="Appearance"
            description="The logo and colour patients and staff see at the top of every page."
        >
            <BrandingFields logoUrl={clinic.logoUrl} brandColour={clinic.brandColour} />
        </Section>
    );
}

export function BookingRulesForm({ clinic }: { clinic: ClinicDetails }) {
    return (
        <Section clinic={clinic} title="Booking rules">
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
                <span className="block text-xs text-slate-500">
                    A patient returning to the same doctor within this many days is marked a
                    revisit. Zero switches it off.
                </span>
            </label>
        </Section>
    );
}

export function HomeCollectionForm({ clinic }: { clinic: ClinicDetails }) {
    return (
        <Section
            clinic={clinic}
            title="Home sample collection"
            description="Where the clinic is, and how far it will send someone."
        >
            <HomeCollectionFields clinic={clinic} />
        </Section>
    );
}

export function AfterHoursForm({ clinic }: { clinic: ClinicDetails }) {
    return (
        <Section
            clinic={clinic}
            title="Out of hours"
            description="What a patient gets when they message outside opening hours."
        >
            {/* An unticked checkbox sends nothing, which is indistinguishable
                from a field belonging to another section. */}
            <input type="hidden" name="afterHoursSection" value="1" />

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
        </Section>
    );
}

export function AddClosureForm() {
    const [state, action, pending] = useActionState<SettingsState, FormData>(addClosure, {});
    const showAdded = useAutoDismiss(state, 8000);

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
                {pending ? "Adding…" : "Add closure"}
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
 *
 * The logo is uploaded rather than typed as an address. It used to be a URL
 * field, which quietly required the clinic to host a PNG somewhere — something
 * most of them have no way to do, so most of them had no logo.
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
    const [logoNotice, setLogoNotice] = useState<SettingsState>({});
    const [busy, startLogo] = useTransition();
    const fileRef = useRef<HTMLInputElement>(null);

    const valid = /^#[0-9a-f]{6}$/i.test(colour);
    const preview = valid ? colour : "#0f766e";

    function choose(file: File | undefined) {
        if (!file) return;

        const form = new FormData();
        form.append("file", file);

        startLogo(async () => {
            const result = await uploadLogo(form);
            setLogoNotice(result);

            if (result.logoUrl !== undefined) {
                setLogo(result.logoUrl ?? "");
            }

            // Without this, choosing the same file again after a failure does
            // not fire a change event.
            if (fileRef.current) fileRef.current.value = "";
        });
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium text-slate-600">Logo</span>
                <div className="flex flex-wrap items-center gap-3">
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => choose(e.target.files?.[0])}
                        aria-label="Logo image"
                        className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
                    />
                    {logo && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                                startLogo(async () => {
                                    const result = await removeLogo();
                                    setLogoNotice(result);
                                    if (result.logoUrl !== undefined) setLogo("");
                                })
                            }
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-300"
                        >
                            Remove
                        </button>
                    )}
                    {busy && <span className="text-xs text-slate-500">Working…</span>}
                </div>
                <span className="block text-xs text-slate-500">
                    PNG, JPEG or WebP, up to 2 MB. Leave it empty to show the clinic&apos;s
                    initials instead. Saved as soon as you choose a file.
                </span>
                {logoNotice.error && (
                    <span className="block text-xs text-red-700" role="alert">
                        {logoNotice.error}
                    </span>
                )}
                {logoNotice.success && !logoNotice.error && (
                    <span className="block text-xs text-emerald-700" role="status">
                        {logoNotice.success}
                    </span>
                )}
            </div>

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

/**
 * Where the clinic is, and how far it will send someone.
 *
 * The coordinates are not decoration: the WhatsApp flow measures the patient's
 * shared location against them. Until both are set, every location pin is
 * accepted however far away it is, so the summary line spells out which of the
 * two states the clinic is currently in.
 */
function HomeCollectionFields({ clinic }: { clinic: ClinicDetails }) {
    // Loose null check on purpose: these read as undefined against a portal
    // that has not been redeployed yet, and String(undefined) is "undefined".
    const [lat, setLat] = useState(clinic.latitude == null ? "" : String(clinic.latitude));
    const [lon, setLon] = useState(clinic.longitude == null ? "" : String(clinic.longitude));
    const [radius, setRadius] = useState(
        clinic.homeCollectionRadiusKm == null ? "" : String(clinic.homeCollectionRadiusKm)
    );

    // Accept a whole "lat, lng" or a maps link dropped into either box.
    function spread(value: string, setSelf: (v: string) => void) {
        const pair = parseCoordinates(value);

        if (pair && /[, ]/.test(value.trim())) {
            setLat(pair.lat);
            setLon(pair.lon);
            return;
        }

        setSelf(value);
    }

    const located = lat.trim() !== "" && lon.trim() !== "";
    const limited = located && radius.trim() !== "" && Number(radius) > 0;

    return (
        <div className="space-y-3">
            {!clinic.homeCollectionEnabled && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Home collection is switched off for this clinic, so these settings are not in
                    use yet.
                </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Latitude</span>
                    <input
                        name="latitude"
                        value={lat}
                        onChange={(e) => spread(e.target.value, setLat)}
                        placeholder="12.9716"
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Longitude</span>
                    <input
                        name="longitude"
                        value={lon}
                        onChange={(e) => spread(e.target.value, setLon)}
                        placeholder="77.5946"
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">
                        Collection radius (km)
                    </span>
                    <input
                        name="homeCollectionRadiusKm"
                        value={radius}
                        onChange={(e) => setRadius(e.target.value)}
                        placeholder="10"
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>
            </div>

            <p className="text-xs text-slate-500">
                Paste the pair straight from Google Maps into either box and they will split
                themselves.{" "}
                {limited ? (
                    <span className="text-slate-500">
                        A patient sharing a location more than {radius} km from here is told it is
                        outside the collection area.
                    </span>
                ) : (
                    <span className="text-amber-700">
                        {located
                            ? "Without a radius, a location any distance away is accepted."
                            : "Until the clinic location is set, a location any distance away is accepted."}
                    </span>
                )}
            </p>
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
