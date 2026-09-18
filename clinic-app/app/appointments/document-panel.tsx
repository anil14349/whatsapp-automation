"use client";

import { useActionState, useEffect, useState } from "react";
import { loadDocuments, sendDocument, type BookingState, type SentDocument } from "./actions";
import { useAutoDismiss } from "@/lib/use-notice";

const KINDS = [
    { value: "REPORT", label: "Lab report" },
    { value: "PRESCRIPTION", label: "Prescription" },
    { value: "INVOICE", label: "Invoice" },
    { value: "OTHER", label: "Other" }
];

/**
 * WhatsApp accepts a message first and says whether it arrived afterwards, so
 * "sent" here deliberately stops short of claiming the patient has it.
 */
const DELIVERY_WORDS: Record<string, string> = {
    PENDING: "sending",
    SENT: "sent, not confirmed",
    DELIVERED: "delivered",
    FAILED: "not delivered"
};

const DELIVERY_STYLES: Record<string, string> = {
    PENDING: "bg-slate-100 text-slate-600",
    SENT: "bg-amber-50 text-amber-800",
    DELIVERED: "bg-emerald-50 text-emerald-700",
    FAILED: "bg-red-50 text-red-700"
};

/**
 * Send a patient their result, and show what has already gone.
 *
 * The history matters more than it looks: a report that WhatsApp refused is
 * the one case where the desk has to do something about it, and without this
 * the only evidence is a row nobody reads.
 */
export function DocumentPanel({
    appointmentId,
    patientName,
    onClose
}: {
    appointmentId: string;
    patientName: string;
    onClose: () => void;
}) {
    const [state, action, pending] = useActionState<BookingState, FormData>(sendDocument, {});
    const [sent, setSent] = useState<SentDocument[] | null>(null);
    const showSent = useAutoDismiss(state);

    useEffect(() => {
        let live = true;

        loadDocuments(appointmentId).then((rows) => {
            if (live) setSent(rows);
        });

        return () => {
            live = false;
        };
    }, [appointmentId, state.success, state.error]);

    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Send to {patientName}</h3>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
                    Close
                </button>
            </div>

            <form action={action} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="appointmentId" value={appointmentId} />

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">What is it</span>
                    <select
                        name="kind"
                        defaultValue="REPORT"
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    >
                        {KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                                {k.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1">
                    <span className="block text-xs font-medium text-slate-600">File</span>
                    <input
                        type="file"
                        name="file"
                        required
                        accept="application/pdf,image/jpeg,image/png"
                        className="block w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs"
                    />
                </label>

                <label className="flex-1 space-y-1">
                    <span className="block text-xs font-medium text-slate-600">
                        Note (optional)
                    </span>
                    <input
                        name="note"
                        placeholder="Anything the patient should read first"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                </label>

                <button
                    disabled={pending}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                >
                    {pending ? "Sending…" : "Send"}
                </button>
            </form>

            <p className="mt-2 text-xs text-slate-500">
                PDF, JPEG or PNG, up to 10 MB. It arrives in the patient&apos;s WhatsApp and stays
                there.
            </p>

            {state.error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {state.error}
                </p>
            )}
            {state.success && showSent && (
                <p
                    className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                    role="status"
                >
                    {state.success}
                </p>
            )}

            {sent !== null && sent.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3">
                    {sent.map((doc) => (
                        <li key={doc.id} className="flex items-center gap-2 text-xs">
                            <span
                                className={`rounded px-1.5 py-0.5 font-medium ${DELIVERY_STYLES[doc.status] ?? "bg-slate-100 text-slate-600"}`}
                            >
                                {DELIVERY_WORDS[doc.status] ?? doc.status.toLowerCase()}
                            </span>
                            <span className="text-slate-700">{doc.file_name}</span>
                            <span className="text-slate-500">
                                {(doc.sent_at ?? doc.created_at).slice(0, 16).replace("T", " ")}
                            </span>
                            {doc.error_message && (
                                <span className="text-red-600">{doc.error_message}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {sent !== null && sent.length === 0 && (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    Nothing sent for this visit yet.
                </p>
            )}
        </div>
    );
}
