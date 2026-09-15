/**
 * Credential delivery over WhatsApp.
 *
 * Staff are identified by their WhatsApp number, so credentials go there
 * first. Meta rejects free-form messages outside the 24 hour window, and a
 * silent failure would leave an admin believing a doctor had been sent a PIN
 * they never received.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_PHONE } from "./helpers/fixtures.ts";
import { sendCredentialOverWhatsApp } from "../shared/credential-delivery.ts";

Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
Deno.env.set("WHATSAPP_ACCESS_TOKEN", "ENV_TOKEN");
Deno.env.set("WHATSAPP_PHONE_NUMBER_ID", "ENV_PHONE");

const realFetch = globalThis.fetch;

/** Stand in for the Meta Graph API. */
function stubGraph(handler: (body: any) => { ok: boolean; status?: number; payload?: unknown }) {
    const calls: any[] = [];

    globalThis.fetch = ((input: any, init?: any) => {
        const body = init?.body ? JSON.parse(init.body) : {};
        calls.push({ url: String(input), body });

        const result = handler(body);

        return Promise.resolve(
            new Response(
                JSON.stringify(result.payload ?? { messages: [{ id: "wamid.test" }] }),
                { status: result.status ?? (result.ok ? 200 : 400) }
            )
        );
    }) as typeof fetch;

    return calls;
}

function restore() {
    globalThis.fetch = realFetch;
}

Deno.test("a credential is sent to the staff member's own number", async () => {
    const supabase = fakeSupabase(seed());
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await sendCredentialOverWhatsApp(
            supabase,
            CLINIC_A,
            DOCTOR_PHONE,
            "Dr A Sharma",
            "419628",
            "PIN"
        );

        assertEquals(result.delivered, true);
        assertEquals(calls.length, 1);
        assertEquals(calls[0].body.to, DOCTOR_PHONE);
    } finally {
        restore();
    }
});

Deno.test("the message is sent from the clinic's own number", async () => {
    const supabase = fakeSupabase(seed());
    const calls = stubGraph(() => ({ ok: true }));

    try {
        await sendCredentialOverWhatsApp(
            supabase,
            CLINIC_A,
            DOCTOR_PHONE,
            "Dr A Sharma",
            "419628",
            "PIN"
        );

        // Clinic A's phone number id is PHONE_A in the fixture.
        assert(
            calls[0].url.includes("PHONE_A"),
            `expected clinic A's number in ${calls[0].url}`
        );
    } finally {
        restore();
    }
});

Deno.test("the credential appears in the message body", async () => {
    const supabase = fakeSupabase(seed());
    const calls = stubGraph(() => ({ ok: true }));

    try {
        await sendCredentialOverWhatsApp(
            supabase,
            CLINIC_A,
            DOCTOR_PHONE,
            "Dr A Sharma",
            "419628",
            "PIN"
        );

        const text = calls[0].body.text.body;

        assert(text.includes("419628"), "credential missing from message");
        assert(text.includes("Dr A Sharma"), "name missing from message");
        assert(text.includes("PIN"), "credential type missing from message");
    } finally {
        restore();
    }
});

Deno.test("being outside the 24 hour window is reported, not swallowed", async () => {
    const supabase = fakeSupabase(seed());

    stubGraph(() => ({
        ok: false,
        status: 400,
        payload: {
            error: {
                code: 131047,
                message: "Message failed to send because more than 24 hours have passed"
            }
        }
    }));

    try {
        const result = await sendCredentialOverWhatsApp(
            supabase,
            CLINIC_A,
            DOCTOR_PHONE,
            "Dr A Sharma",
            "419628",
            "PIN"
        );

        assertEquals(result.delivered, false);
        assertEquals(result.reason, "outside_window");
    } finally {
        restore();
    }
});

Deno.test("any other send failure is reported as a failure", async () => {
    const supabase = fakeSupabase(seed());

    stubGraph(() => ({
        ok: false,
        status: 401,
        payload: { error: { code: 190, message: "Malformed access token" } }
    }));

    try {
        const result = await sendCredentialOverWhatsApp(
            supabase,
            CLINIC_A,
            DOCTOR_PHONE,
            "Dr A Sharma",
            "419628",
            "PIN"
        );

        assertEquals(result.delivered, false);
        assertEquals(result.reason, "send_failed");
    } finally {
        restore();
    }
});

Deno.test("a staff member with no phone number is reported, not attempted", async () => {
    const supabase = fakeSupabase(seed());
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await sendCredentialOverWhatsApp(
            supabase,
            CLINIC_A,
            null,
            "Asha Menon",
            "secret",
            "password"
        );

        assertEquals(result.delivered, false);
        assertEquals(result.reason, "no_phone");
        assertEquals(calls.length, 0, "should not call Meta without a number");
    } finally {
        restore();
    }
});

Deno.test("delivery is refused when the clinic has no sending credentials", async () => {
    const supabase = fakeSupabase(seed());
    supabase.store.clinics[0].whatsapp_access_token = null;
    supabase.store.clinics[0].whatsapp_phone_number_id = null;

    // The env fallback would otherwise stand in for a clinic with no setup.
    Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    Deno.env.delete("WHATSAPP_PHONE_NUMBER_ID");

    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await sendCredentialOverWhatsApp(
            supabase,
            "cccccccc-0000-0000-0000-00000000000c",
            DOCTOR_PHONE,
            "Dr A Sharma",
            "419628",
            "PIN"
        );

        assertEquals(result.delivered, false);
        assertEquals(result.reason, "no_credentials");
        assertEquals(calls.length, 0);
    } finally {
        restore();
        Deno.env.set("WHATSAPP_ACCESS_TOKEN", "ENV_TOKEN");
        Deno.env.set("WHATSAPP_PHONE_NUMBER_ID", "ENV_PHONE");
    }
});
