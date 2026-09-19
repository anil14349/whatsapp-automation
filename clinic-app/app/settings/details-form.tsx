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
            // Not "and patients": the logo is read from clinics.logo_url by the
            // portal header alone. WhatsApp messages carry no image, and the
            // profile picture patients see is set in Meta, not here.
            description="Your clinic's logo and primary colour, as staff see them across the portal."
        >
            <BrandingFields
                logoUrl={clinic.logoUrl}
                brandColour={clinic.brandColour}
                clinicName={clinic.name}
            />
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
            <input type="hidden" name="homeCollectionSection" value="1" />
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
                className="ml-auto rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
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
    brandColour,
    clinicName
}: {
    logoUrl: string | null;
    brandColour: string | null;
    clinicName: string;
}) {
    const [logo, setLogo] = useState(logoUrl ?? "");
    const [colour, setColour] = useState(brandColour ?? "");
    const [logoNotice, setLogoNotice] = useState<SettingsState>({});
    const [busy, startLogo] = useTransition();
    const fileRef = useRef<HTMLInputElement>(null);

    const valid = /^#[0-9a-f]{6}$/i.test(colour);
    const preview = valid ? colour : "#0f766e";

    // The same rule the header uses, so the preview is not a flattering lie.
    const initials = clinicName
        .split(/\s+/)
        .filter((word) => /[a-z0-9]/i.test(word))
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase())
        .join("");

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

    function remove() {
        startLogo(async () => {
            const result = await removeLogo();
            setLogoNotice(result);
            if (result.logoUrl !== undefined) setLogo("");
        });
    }

    return (
        <div className="max-w-3xl space-y-6">
            <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => choose(e.target.files?.[0])}
                aria-label="Logo image"
                className="hidden"
            />

            <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Brand logo
                </h3>

                {logo ? (
                    <div className="flex flex-wrap items-start gap-4">
                        <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-slate-700">Current logo</p>
                            <p className="text-xs text-slate-500">
                                PNG, JPEG or WebP · up to 2 MB
                            </p>
                            <div className="flex items-center gap-4 pt-1">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => fileRef.current?.click()}
                                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300 disabled:opacity-50"
                                >
                                    Replace logo
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={remove}
                                    className="text-sm text-slate-500 hover:text-red-700 disabled:opacity-50"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => fileRef.current?.click()}
                        className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 hover:border-brand-400 disabled:opacity-50"
                    >
                        <span className="text-sm font-medium text-slate-700">
                            Upload clinic logo
                        </span>
                        <span className="text-xs text-slate-500">
                            PNG, JPEG or WebP · up to 2 MB
                        </span>
                        <span className="mt-2 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white">
                            Browse
                        </span>
                        <span className="mt-1 text-xs text-slate-500">
                            Without one, the header shows the clinic&apos;s initials.
                        </span>
                    </button>
                )}

                {busy && <p className="text-xs text-slate-500">Working…</p>}
                {logoNotice.error && (
                    <p className="text-xs text-red-700" role="alert">
                        {logoNotice.error}
                    </p>
                )}
                {logoNotice.success && !logoNotice.error && (
                    <p className="text-xs text-emerald-700" role="status">
                        {logoNotice.success}
                    </p>
                )}
                <p className="text-xs text-slate-500">Saved as soon as you choose a file.</p>
            </section>

            <hr className="border-slate-100" />

            <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Brand colour
                </h3>

                <label className="block space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Primary colour</span>
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
                            spellCheck={false}
                            className="w-32 rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-sm"
                        />
                    </div>
                    {colour && !valid && (
                        <span className="block text-xs text-amber-700">
                            Needs to look like #0f766e
                        </span>
                    )}
                    {!colour && (
                        // The empty box reads as disabled otherwise, which is
                        // what it was mistaken for.
                        <span className="block text-xs text-slate-500">
                            Not set, so the portal uses its default teal.
                        </span>
                    )}
                </label>

                <div className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">Preview</span>
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                            <div className="flex items-center gap-2">
                                {logo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={logo}
                                        alt=""
                                        className="h-8 w-8 rounded-lg object-contain"
                                    />
                                ) : (
                                    <span
                                        className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold"
                                        style={{
                                            backgroundColor: preview,
                                            color: readableOn(preview)
                                        }}
                                    >
                                        {initials}
                                    </span>
                                )}
                                <span className="text-sm font-medium text-slate-900">
                                    {clinicName}
                                </span>
                            </div>
                            <span
                                className="rounded-lg px-3 py-1.5 text-sm font-medium"
                                style={{ backgroundColor: preview, color: readableOn(preview) }}
                            >
                                Book appointment
                            </span>
                        </div>
                        <div className="px-4 py-3 text-xs text-slate-500">
                            This is the header staff see on every page of the portal.
                        </div>
                    </div>
                </div>
            </section>
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

    // Switching it on is a promise to travel to someone's house, so the things
    // that make that possible have to exist first. The server refuses too;
    // this is so nobody has to submit the form to find out.
    const blockers = clinic.homeCollectionBlockedBy ?? [];
    const canEnable = clinic.homeCollectionEnabled || blockers.length === 0;

    return (
        <div className="space-y-3">
            <label
                className={`flex items-start gap-2 text-sm ${canEnable ? "" : "opacity-60"}`}
            >
                <input
                    type="checkbox"
                    name="homeCollectionEnabled"
                    defaultChecked={clinic.homeCollectionEnabled}
                    disabled={!canEnable}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                    Offer home sample collection to patients
                    {!canEnable && (
                        <span className="mt-1 block text-xs text-amber-700">
                            Not yet. Still needs {blockers.join(", ")}.
                        </span>
                    )}
                </span>
            </label>

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
