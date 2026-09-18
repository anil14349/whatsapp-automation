"use client";

import { useState, useTransition } from "react";
import { updateService, renameService, removeService, type ServiceRow, type ServiceState } from "./actions";
import { Switch } from "@/components/switch";
import { useNotice } from "@/lib/use-notice";

export function ServiceManager({ services }: { services: ServiceRow[] }) {
    const [notice, setNotice] = useNotice<ServiceState>({});
    const [busy, start] = useTransition();
    const [editing, setEditing] = useState<string | null>(null);

    function save(id: string, changes: Parameters<typeof updateService>[1]) {
        start(async () => setNotice(await updateService(id, changes)));
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

            <div className="space-y-2">
                {services.map((s) => {
                    const open = editing === s.serviceTypeId;
                    const price = s.clinicPrice ?? s.defaults.clinicPrice;
                    const duration = s.durationMinutes ?? s.defaults.durationMinutes;

                    return (
                        <div
                            key={s.serviceTypeId}
                            className="rounded-xl bg-white p-4 ring-1 ring-slate-200"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{s.name}</span>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                            {s.category}
                                        </span>
                                        {s.isOwn && (
                                            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                                                yours
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        {price !== null ? `₹${price}` : "no price"} · {duration ?? 30} min
                                        {s.requiresDoctor ? " · needs a doctor" : " · no doctor needed"}
                                        {s.concurrentCapacity > 1 && ` · ${s.concurrentCapacity} at a time`}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <Switch
                                        checked={s.isEnabled}
                                        disabled={busy}
                                        label={`Offer ${s.name} to patients`}
                                        describe={(on: boolean) => (on ? "Offered" : "Not offered")}
                                        onChange={(next) =>
                                            save(s.serviceTypeId, { isEnabled: next })
                                        }
                                    />
                                    <button
                                        disabled={busy}
                                        onClick={() => setEditing(open ? null : s.serviceTypeId)}
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-slate-300 disabled:opacity-50"
                                    >
                                        {open ? "Close" : "Edit"}
                                    </button>
                                </div>
                            </div>

                            {open && (
                                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                        <NameField
                                            value={s.name}
                                            catalogueName={s.isOwn ? null : s.catalogueName}
                                            disabled={busy}
                                            onSave={(next) =>
                                                start(async () =>
                                                    setNotice(await renameService(s.serviceTypeId, next))
                                                )
                                            }
                                        />
                                    </div>
                                    <Toggle
                                        label="At the clinic"
                                        value={s.offeredAtClinic}
                                        disabled={busy}
                                        onChange={(v) => save(s.serviceTypeId, { offeredAtClinic: v })}
                                    />
                                    <Toggle
                                        label="At the patient's home"
                                        value={s.offeredAtHome}
                                        disabled={busy}
                                        onChange={(v) => save(s.serviceTypeId, { offeredAtHome: v })}
                                    />
                                    <Toggle
                                        label="Needs a doctor chosen"
                                        value={s.requiresDoctor}
                                        disabled={busy}
                                        onChange={(v) => save(s.serviceTypeId, { requiresDoctor: v })}
                                    />
                                    <NumberField
                                        label="Patients at once"
                                        value={s.concurrentCapacity}
                                        placeholder="1"
                                        disabled={busy || s.requiresDoctor}
                                        hint={s.requiresDoctor ? "A doctor sees one at a time" : undefined}
                                        onSave={(v) =>
                                            save(s.serviceTypeId, { concurrentCapacity: v ?? 1 })
                                        }
                                    />
                                    <NumberField
                                        label="Clinic price (₹)"
                                        value={s.clinicPrice}
                                        placeholder={String(s.defaults.clinicPrice ?? "")}
                                        disabled={busy}
                                        hint="Blank uses the standard price"
                                        onSave={(v) => save(s.serviceTypeId, { clinicPrice: v })}
                                    />
                                    <NumberField
                                        label="Home price (₹)"
                                        value={s.homePrice}
                                        placeholder={String(s.defaults.homePrice ?? "")}
                                        disabled={busy}
                                        hint="Blank uses the standard price"
                                        onSave={(v) => save(s.serviceTypeId, { homePrice: v })}
                                    />
                                    <NumberField
                                        label="Minutes per appointment"
                                        value={s.durationMinutes}
                                        placeholder={String(s.defaults.durationMinutes ?? "")}
                                        disabled={busy}
                                        hint="Decides how slots are spaced"
                                        onSave={(v) => save(s.serviceTypeId, { durationMinutes: v })}
                                    />
                                    <NumberField
                                        label="Least notice (hours)"
                                        value={s.minNoticeHours}
                                        placeholder="0"
                                        disabled={busy}
                                        hint="Time you need before this can be booked"
                                        onSave={(v) => save(s.serviceTypeId, { minNoticeHours: v ?? 0 })}
                                    />

                                    {s.isOwn ? (
                                        <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
                                            <span className="text-xs text-slate-400">
                                                Refused while patients are still booked for it
                                            </span>
                                            <button
                                                disabled={busy}
                                                onClick={() =>
                                                    start(async () =>
                                                        setNotice(await removeService(s.serviceTypeId))
                                                    )
                                                }
                                                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:border-red-300 disabled:opacity-50"
                                            >
                                                Remove this service
                                            </button>
                                        </div>
                                    ) : (
                                        // The Remove button is absent here rather than present and
                                        // failing, so this has to say why.
                                        <p className="sm:col-span-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                                            Every clinic shares this service, so deleting it would
                                            delete it for all of them. Switching it off takes it away
                                            from your patients, which is the same thing from here.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function NameField({
    value,
    catalogueName,
    disabled,
    onSave
}: {
    value: string;
    catalogueName: string | null;
    disabled: boolean;
    onSave: (value: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const renamed = catalogueName !== null && catalogueName !== value;

    return (
        <label className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-600">Name</span>
            <input
                value={draft}
                maxLength={24}
                disabled={disabled}
                onChange={(e) => setDraft(e.target.value)}
                // Saved on blur, so a half-typed name is never sent.
                onBlur={() => {
                    const next = draft.trim();
                    if (next && next !== value) onSave(next);
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
            <span className="block text-xs text-slate-400">
                {renamed
                    ? `This is what patients see. Normally called "${catalogueName}".`
                    : "This is what patients see on their phone"}
            </span>
        </label>
    );
}

function Toggle({
    label,
    value,
    disabled,
    onChange
}: {
    label: string;
    value: boolean;
    disabled: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-sm">
            <input
                type="checkbox"
                checked={value}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
            />
            <span>{label}</span>
        </label>
    );
}

function NumberField({
    label,
    value,
    placeholder,
    disabled,
    hint,
    onSave
}: {
    label: string;
    value: number | null;
    placeholder: string;
    disabled: boolean;
    hint?: string;
    onSave: (value: number | null) => void;
}) {
    const [draft, setDraft] = useState(value === null ? "" : String(value));

    return (
        <label className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-600">{label}</span>
            <input
                type="number"
                min="0"
                value={draft}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(e) => setDraft(e.target.value)}
                // Saved on blur so a half-typed number is never sent.
                onBlur={() => {
                    const next = draft.trim() === "" ? null : Number(draft);
                    if (next !== value) onSave(next);
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
            {hint && <span className="block text-xs text-slate-400">{hint}</span>}
        </label>
    );
}
