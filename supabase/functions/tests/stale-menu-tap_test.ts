/**
 * Tapping an older menu button while the bot is waiting for a location.
 *
 * WhatsApp leaves every button tappable forever, so scrolling up and tapping
 * "More Options" is ordinary behaviour, not misuse. It was once taken as the
 * street address and read back: `Address: "menu_more"`, seen on a real
 * handset. The flow that did that is gone, but the same tap still arrives
 * while BOOK_ADDRESS waits for a pin, so the guard still has to hold.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

function build(state: string) {
    const supabase = fakeSupabase(seed());

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state,
            data: { language: "EN", locationType: "HOME" },
            role: "PATIENT"
        }
    ];

    const wa = new FakeWhatsAppClient();

    const send = (text: string, messageType = "interactive") =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: PATIENT_PHONE,
            senderName: "Sim",
            messageText: text,
            messageType,
            clinicId: CLINIC_A
        });

    const session = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, send, session, said };
}

Deno.test("a menu button tapped while a location is being asked for is not the address", async () => {
    const { send, session, said } = build("BOOK_ADDRESS");

    await send(BUTTON_IDS.PATIENT_MENU.MORE);

    assertEquals(session()?.data?.serviceAddress, undefined);
    assert(!said().includes("menu_more"), `the id was read back to the patient:\n${said()}`);
});

Deno.test("the tap reaches the menu rather than being swallowed", async () => {
    const { send, session } = build("BOOK_ADDRESS");

    await send(BUTTON_IDS.PATIENT_MENU.MORE);

    assertEquals(session()?.state, "MAIN_MENU");
});

Deno.test("a menu id typed as text is not stored as somebody's address", async () => {
    const { send, session } = build("BOOK_ADDRESS");

    await send("menu_more", "text");

    assertEquals(session()?.data?.serviceAddress, undefined);
});

Deno.test("a typed address is refused rather than stored", async () => {
    const { send, session } = build("BOOK_ADDRESS");

    await send("12 Nehru Road, Connaught Place", "text");

    assertEquals(session()?.state, "BOOK_ADDRESS");
    assertEquals(session()?.data?.serviceAddress, undefined);
});

Deno.test("the landmark step does accept text, the pin having been taken already", async () => {
    const { send, session } = build("BOOK_ADDRESS_DETAIL");

    await send("Flat 3B, above the chemist", "text");

    assertEquals(session()?.data?.serviceAddress, "Flat 3B, above the chemist");
});
