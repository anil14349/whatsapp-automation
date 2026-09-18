/**
 * Getting a report or a prescription back to the patient.
 *
 * The clinic can take a booking, run the visit and mark it complete, and then
 * the trail stops. The result goes out on paper or from somebody's personal
 * WhatsApp, which is slower than the booking it follows and leaves no record
 * that it was sent at all.
 *
 * The file is held privately. Meta fetches it once, over a signed URL that
 * expires shortly afterwards, and re-hosts it in the conversation, so the
 * patient keeps the document without the clinic publishing anything.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { getClinicRouteById } from "./clinic-routing.ts";
import { sendProactive, type ProactiveResult } from "./proactive.ts";
import { debug } from "./logger.ts";

export const BUCKET = "patient-documents";

/** Long enough for Meta to fetch it, short enough not to be a public link. */
export const SIGNED_URL_SECONDS = 600;

export const MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png"
};

export type DocumentKind = "REPORT" | "PRESCRIPTION" | "INVOICE" | "OTHER";

export const KIND_LABELS: Record<DocumentKind, string> = {
    REPORT: "report",
    PRESCRIPTION: "prescription",
    INVOICE: "invoice",
    OTHER: "document"
};

export function isDocumentKind(value: unknown): value is DocumentKind {
    return typeof value === "string" && value in KIND_LABELS;
}

/**
 * Reduce an uploaded name to something safe to store and to show.
 *
 * The name arrives from whoever uploaded the file, and it ends up in a storage
 * key and in a WhatsApp filename. Slashes and dot segments are the whole
 * problem: without this, "../../other-clinic/x.pdf" is a valid object key.
 */
export function safeFileName(raw: string, contentType: string): string {
    const base = (raw.split(/[\\/]/).pop() ?? "").trim();

    const cleaned = base
        .replace(/[^A-Za-z0-9._ -]/g, "")
        .replace(/\.{2,}/g, ".")
        .replace(/^\.+/, "")
        .slice(0, 120);

    const fallback = `${KIND_LABELS.REPORT}.${ALLOWED_TYPES[contentType] ?? "pdf"}`;

    if (!cleaned || cleaned === ".") {
        return fallback;
    }

    // A name with no extension arrives on the phone as an unopenable blob.
    return /\.[A-Za-z0-9]{1,8}$/.test(cleaned)
        ? cleaned
        : `${cleaned}.${ALLOWED_TYPES[contentType] ?? "pdf"}`;
}

/** Clinic-prefixed and server-generated, so one clinic cannot address another's. */
export function storageKey(clinicId: string, fileName: string): string {
    return `${clinicId}/${crypto.randomUUID()}-${fileName}`;
}

export type SendResult =
    | { ok: true; id: string; status: "SENT" | "FAILED"; error?: string }
    | { ok: false; error: string };

/**
 * Store the file, send it, and record what happened either way.
 *
 * The row is written before the send so a failure is visible to the desk
 * rather than lost: the patient is waiting for a result, and "we sent it" has
 * to mean something.
 */
export async function storeAndSendDocument(
    supabase: SupabaseClient,
    options: {
        clinicId: string;
        patientPhone: string;
        patientName?: string | null;
        appointmentId?: string | null;
        kind: DocumentKind;
        fileName: string;
        contentType: string;
        bytes: Uint8Array;
        uploadedBy: string;
        note?: string;
    }
): Promise<SendResult> {
    const fileName = safeFileName(options.fileName, options.contentType);
    const path = storageKey(options.clinicId, fileName);

    const upload = await supabase.storage
        .from(BUCKET)
        .upload(path, options.bytes, { contentType: options.contentType, upsert: false });

    if (upload.error) {
        debug("patientDocuments", "Upload failed", { error: upload.error.message });
        return { ok: false, error: `Could not store the file: ${upload.error.message}` };
    }

    const { data: row, error: insertError } = await supabase
        .from("patient_documents")
        .insert({
            clinic_id: options.clinicId,
            appointment_id: options.appointmentId ?? null,
            patient_phone: options.patientPhone,
            patient_name: options.patientName ?? null,
            kind: options.kind,
            file_name: fileName,
            storage_path: path,
            size_bytes: options.bytes.byteLength,
            content_type: options.contentType,
            status: "PENDING",
            uploaded_by: options.uploadedBy
        })
        .select("id")
        .single();

    if (insertError || !row) {
        // Nothing points at the object now, so it would sit there unreachable.
        await supabase.storage.from(BUCKET).remove([path]);

        debug("patientDocuments", "Insert failed", { error: insertError?.message });
        return { ok: false, error: "Could not record the document" };
    }

    const outcome = await deliver(supabase, options.clinicId, path, {
        phone: options.patientPhone,
        name: options.patientName ?? "there",
        kind: options.kind,
        fileName,
        note: options.note
    });

    await supabase
        .from("patient_documents")
        .update({
            status: outcome.delivered ? "SENT" : "FAILED",
            message_id: outcome.messageId ?? null,
            error_message: outcome.delivered ? null : outcome.error ?? outcome.reason ?? "Send failed",
            sent_at: outcome.delivered ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

    return outcome.delivered
        ? { ok: true, id: row.id, status: "SENT" }
        : {
            ok: true,
            id: row.id,
            status: "FAILED",
            error: outcome.reason === "outside_window"
                ? "The patient has not messaged recently, and the document template is not approved yet."
                : outcome.error ?? "Could not send the document"
        };
}

async function deliver(
    supabase: SupabaseClient,
    clinicId: string,
    path: string,
    to: { phone: string; name: string; kind: DocumentKind; fileName: string; note?: string }
): Promise<ProactiveResult> {
    const route = await getClinicRouteById(supabase, clinicId);

    if (!route) {
        return {
            delivered: false,
            reason: "send_failed",
            error: "Clinic has no WhatsApp credentials",
            retryable: false
        };
    }

    const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);

    if (signed.error || !signed.data?.signedUrl) {
        return {
            delivered: false,
            reason: "send_failed",
            error: "Could not prepare the file for sending",
            retryable: true
        };
    }

    const client = new WhatsAppClient(route.accessToken, route.phoneNumberId, supabase, clinicId);
    const label = KIND_LABELS[to.kind];

    // Not "reply if you have questions": a reply reaches the booking menu, and
    // there is no inbox in the portal for anyone to read it in.
    const askUs = "\n\nPlease call the clinic if you have any questions.";

    const caption = to.note?.trim()
        ? `📄 Your ${label} from ${route.clinicName}\n\n${to.note.trim()}${askUs}`
        : `📄 Your ${label} from ${route.clinicName}${askUs}`;

    return await sendProactive(
        client,
        to.phone,
        caption,
        {
            key: "patient_document",
            parameters: [to.name, label],
            header: { type: "document", link: signed.data.signedUrl, filename: to.fileName }
        },
        { document: { link: signed.data.signedUrl, filename: to.fileName } }
    );
}
