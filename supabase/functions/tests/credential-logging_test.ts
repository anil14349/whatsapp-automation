/**
 * Credentials must not end up in `whatsapp_log`.
 *
 * Two separate leaks, found by reading a real log line: a staff member's
 * temporary password was written out in full on the way out, and a doctor's
 * PIN was written out in full on the way in. The second is worse — a password
 * is meant to be changed on first use, a PIN is the credential itself.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { redactCredentials, WITHHELD } from "../shared/inbound-redaction.ts";
import { sendProactive } from "../shared/proactive.ts";

const PHONE = "919876500010";

function sessionAt(state: string) {
    const supabase = fakeSupabase({});
    supabase.store.whatsapp_sessions = [{ phone: PHONE, state, data: {} }];
    return supabase;
}

Deno.test("a PIN typed at the login prompt is not written to the log", async () => {
    const supabase = sessionAt("DOCTOR_LOGIN");

    assertEquals(await redactCredentials(supabase as any, PHONE, "text", "778291"), WITHHELD);
});

Deno.test("a PIN being changed or reset is withheld too", async () => {
    for (const state of ["DOCTOR_CHANGE_PIN", "DOCTOR_RESET_PIN"]) {
        const supabase = sessionAt(state);

        assertEquals(await redactCredentials(supabase as any, PHONE, "text", "4821"), WITHHELD);
    }
});

Deno.test("a six digit postcode from a patient is still logged", async () => {
    const supabase = sessionAt("HOME_COLLECTION_ADDRESS");

    assertEquals(await redactCredentials(supabase as any, PHONE, "text", "110001"), "110001");
});

Deno.test("a button id at the PIN prompt is kept, being no secret", async () => {
    const supabase = sessionAt("DOCTOR_LOGIN");

    assertEquals(
        await redactCredentials(supabase as any, PHONE, "interactive", "doctor_forgot_pin"),
        "doctor_forgot_pin"
    );
});

Deno.test("ordinary words are never touched", async () => {
    const supabase = sessionAt("DOCTOR_LOGIN");

    assertEquals(await redactCredentials(supabase as any, PHONE, "text", "hi"), "hi");
});

Deno.test("a failed session lookup withholds rather than logs", async () => {
    const supabase = fakeSupabase({});
    supabase.failOn("whatsapp_sessions", { message: "boom" });

    assertEquals(await redactCredentials(supabase as any, PHONE, "text", "778291"), WITHHELD);
});

Deno.test("the person still receives the credential; only the record changes", async () => {
    const wa = new FakeWhatsAppClient();

    await sendProactive(
        wa,
        PHONE,
        "Hello Asha, a new password has been issued for you:\n\nAc9#XGFGvUwMZ5mp",
        null,
        { logAs: "Portal password issued to Asha (not recorded)" }
    );

    assertEquals(wa.sent.at(-1)?.body.includes("Ac9#XGFGvUwMZ5mp"), true);
});
