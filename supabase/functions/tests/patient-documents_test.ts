/**
 * Sending a patient their report.
 *
 * Two things carry real risk here. The filename arrives from whoever uploaded
 * the file and ends up in a storage key, so "../" in it would write into
 * another clinic's prefix. And a document that is stored but refused by Meta
 * must read as not sent — the patient is waiting for a result, and a row that
 * says SENT when nothing arrived is worse than an obvious failure.
 */

import { assert, assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { outsideWindowReply, restoreFetch, stubGraph } from "./helpers/fake-graph.ts";
import { seed, CLINIC_A, CLINIC_B, PATIENT_PHONE } from "./helpers/fixtures.ts";
import {
    BUCKET,
    safeFileName,
    storageKey,
    storeAndSendDocument
} from "../shared/patient-documents.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function upload(supabase: any, over: Record<string, unknown> = {}) {
    return storeAndSendDocument(supabase, {
        clinicId: CLINIC_A,
        patientPhone: PATIENT_PHONE,
        patientName: "Asha Rao",
        appointmentId: null,
        kind: "REPORT",
        fileName: "blood-count.pdf",
        contentType: "application/pdf",
        bytes: PDF,
        uploadedBy: "receptionist:desk@example.com",
        ...over
    } as any);
}

Deno.test("a crafted filename cannot escape the clinic's own prefix", () => {
    assertEquals(safeFileName("../../other/secret.pdf", "application/pdf"), "secret.pdf");
    assertEquals(safeFileName("..\\..\\windows\\evil.pdf", "application/pdf"), "evil.pdf");
    assertEquals(safeFileName("/etc/passwd", "application/pdf"), "passwd.pdf");

    const key = storageKey(CLINIC_A, safeFileName("../../escape.pdf", "application/pdf"));

    assert(key.startsWith(`${CLINIC_A}/`), key);
    assert(!key.includes(".."), key);
});

Deno.test("a filename with no extension still opens on the phone", () => {
    assertEquals(safeFileName("report", "application/pdf"), "report.pdf");
    assertEquals(safeFileName("scan", "image/jpeg"), "scan.jpg");
});

Deno.test("an empty or hostile filename falls back rather than failing", () => {
    assertEquals(safeFileName("", "application/pdf"), "report.pdf");
    assertEquals(safeFileName("   ", "application/pdf"), "report.pdf");
    assertEquals(safeFileName("...", "application/pdf"), "report.pdf");
    assertEquals(safeFileName("<script>.pdf", "application/pdf"), "script.pdf");
});

Deno.test("two uploads of the same name do not collide", () => {
    const a = storageKey(CLINIC_A, "report.pdf");
    const b = storageKey(CLINIC_A, "report.pdf");

    assert(a !== b, "each upload needs its own key or one overwrites the other");
});

Deno.test("one clinic's key is never another's", () => {
    assert(storageKey(CLINIC_A, "r.pdf").startsWith(CLINIC_A));
    assert(!storageKey(CLINIC_B, "r.pdf").startsWith(CLINIC_A));
});

Deno.test("a sent document is stored and recorded against the clinic", async () => {
    const supabase = fakeSupabase(seed());
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await upload(supabase);

        assertEquals(result.ok, true);
        if (result.ok) assertEquals(result.status, "SENT");

        const row = supabase.rows("patient_documents")[0];

        assertEquals(row.clinic_id, CLINIC_A);
        assertEquals(row.patient_phone, PATIENT_PHONE);
        assertEquals(row.file_name, "blood-count.pdf");
        assertEquals(row.size_bytes, PDF.byteLength);
        assertEquals(row.status, "SENT");
        assert(row.sent_at, "a delivered document needs a time on it");

        const object = supabase.storage.objects[0];

        assertEquals(object.bucket, BUCKET);
        assert(object.path.startsWith(`${CLINIC_A}/`), object.path);

        // The file goes as a document, not as a link in a text message.
        assertEquals(calls[0].body.type, "document");
        assertEquals(calls[0].body.document.filename, "blood-count.pdf");
        assertStringIncludes(calls[0].body.document.link, object.path);
    } finally {
        restoreFetch();
    }
});

Deno.test("the link Meta is given is signed, not a public bucket path", async () => {
    const supabase = fakeSupabase(seed());
    const calls = stubGraph(() => ({ ok: true }));

    try {
        await upload(supabase);

        const link = calls[0].body.document.link;

        assertStringIncludes(link, "exp=", "an unsigned link would leave the report readable");
    } finally {
        restoreFetch();
    }
});

Deno.test("a document refused for the window is recorded as not sent", async () => {
    const supabase = fakeSupabase(seed());
    stubGraph(() => outsideWindowReply());

    try {
        const result = await upload(supabase);

        assertEquals(result.ok, true);

        if (result.ok) {
            assertEquals(result.status, "FAILED");
            assertStringIncludes(result.error ?? "", "not messaged recently");
        }

        const row = supabase.rows("patient_documents")[0];

        assertEquals(row.status, "FAILED");
        assertEquals(row.sent_at, null);
        assert(row.error_message, "a failure the desk cannot see is no better than silence");
    } finally {
        restoreFetch();
    }
});

Deno.test("the file is kept even when the send fails, so it can go again", async () => {
    const supabase = fakeSupabase(seed());
    stubGraph(() => outsideWindowReply());

    try {
        await upload(supabase);

        assertEquals(supabase.storage.objects.length, 1);
    } finally {
        restoreFetch();
    }
});

Deno.test("a file that cannot be prepared for sending never reaches Meta", async () => {
    const supabase = fakeSupabase(seed());
    supabase.storage.signedUrlError = { message: "signing unavailable" };
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await upload(supabase);

        assertEquals(result.ok, true);
        if (result.ok) assertEquals(result.status, "FAILED");
        assertEquals(calls.length, 0);
    } finally {
        restoreFetch();
    }
});

Deno.test("a file that cannot be stored is not recorded as sent", async () => {
    const supabase = fakeSupabase(seed());
    supabase.storage.uploadError = { message: "bucket is full" };

    const result = await upload(supabase);

    assertEquals(result.ok, false);
    assertEquals(supabase.rows("patient_documents").length, 0);

    if (!result.ok) {
        assertStringIncludes(result.error, "bucket is full");
    }
});

Deno.test("a file stored but not recorded is removed rather than orphaned", async () => {
    const supabase = fakeSupabase(seed());
    supabase.failOn("patient_documents", { message: "insert exploded" });

    const result = await upload(supabase);

    assertEquals(result.ok, false);
    assertEquals(
        supabase.storage.objects.length,
        0,
        "nothing points at the object now, so it must not be left behind"
    );
});
