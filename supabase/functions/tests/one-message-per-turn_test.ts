/**
 * One message per turn.
 *
 * Choosing a language produced two bubbles a second apart: a welcome that
 * asked "What would you like to do today?" with nothing to tap, and then a
 * second message asking the same question with the buttons on it. Every reply
 * the bot sends should be the thing to act on, not a preamble.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

function build(state: string, data: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());

    supabase.store.whatsapp_sessions = [
        { phone: PATIENT_PHONE, clinic_id: CLINIC_A, state, data, role: "PATIENT" }
    ];

    const wa = new FakeWhatsAppClient();

    const tap = (id: string) =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: PATIENT_PHONE,
            senderName: "Sim",
            messageText: id,
            messageType: "interactive",
            clinicId: CLINIC_A
        });

    return { supabase, wa, tap };
}

Deno.test("choosing a language answers with one message, and it is tappable", async () => {
    const { wa, tap } = build("LANGUAGE_SELECT");

    await tap(BUTTON_IDS.LANGUAGE.EN);

    assertEquals(wa.sent.length, 1, `sent ${wa.sent.length}:\n${wa.sent.map((m) => m.body).join("\n--\n")}`);
    assertEquals(wa.sent[0].type, "buttons");
});

Deno.test("the welcome and the question are in the same bubble as the buttons", async () => {
    const { wa, tap } = build("LANGUAGE_SELECT");

    await tap(BUTTON_IDS.LANGUAGE.EN);

    const only = wa.sent[0];

    assert(only.body.includes("Welcome"), only.body);
    assert(only.body.includes("What would you like to do?"), only.body);
    assert((only.buttons?.length ?? 0) > 0, "no buttons on the only message");
});

Deno.test("the question is not asked twice in the one message", async () => {
    const { wa, tap } = build("LANGUAGE_SELECT");

    await tap(BUTTON_IDS.LANGUAGE.EN);

    const asked = wa.sent[0].body.match(/What would you like to do/g) ?? [];

    assertEquals(asked.length, 1, wa.sent[0].body);
});

Deno.test("abandoning a booking returns one message carrying the outcome", async () => {
    const { wa, tap } = build("BOOK_CONFIRM", { language: "EN" });

    await tap(BUTTON_IDS.CONFIRMATION.NO);

    assertEquals(wa.sent.length, 1, `sent ${wa.sent.length}:\n${wa.sent.map((m) => m.body).join("\n--\n")}`);
    assert(wa.sent[0].body.includes("cancelled"), wa.sent[0].body);
    assert((wa.sent[0].buttons?.length ?? 0) > 0, "the outcome arrived without the menu");
});
