/**
 * Tapping an older menu button while the bot is waiting for an address.
 *
 * WhatsApp leaves every button tappable forever, so scrolling up and tapping
 * "More Options" is ordinary behaviour, not misuse. The patient handler has
 * honoured menu ids from any state for exactly that reason — but routing to
 * the home collection flow happens first, by state, so that guard was never
 * reached. The button's internal id was taken as the street address and read
 * back: `Address: "menu_more"`. Seen on a real handset.
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
            data: { language: "EN" },
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

Deno.test("a menu button tapped while an address is being asked for is not the address", async () => {
    const { send, session, said } = build("LOCATION_SELECT");

    await send(BUTTON_IDS.PATIENT_MENU.MORE);

    assertEquals(session()?.data?.address, undefined);
    assert(!said().includes("menu_more"), `the id was read back to the patient:\n${said()}`);
});

Deno.test("the same tap while confirming an address does not overwrite it either", async () => {
    const { send, session, said } = build("LOCATION_VERIFY");

    await send(BUTTON_IDS.PATIENT_MENU.BOOK);

    assert(session()?.data?.address !== BUTTON_IDS.PATIENT_MENU.BOOK);
    assert(!said().includes("menu_book"), `the id was read back to the patient:\n${said()}`);
});

Deno.test("a real address is still accepted and read back", async () => {
    const { send, session, said } = build("LOCATION_SELECT");

    await send("12 Nehru Road, Connaught Place", "text");

    assertEquals(session()?.state, "LOCATION_VERIFY");
    assertEquals(session()?.data?.address, "12 Nehru Road, Connaught Place");
    assert(said().includes("12 Nehru Road"));
});

Deno.test("an address that merely looks like an id is still treated as typed text", async () => {
    const { send, session } = build("LOCATION_SELECT");

    // Not interactive, so it is what the patient typed, whatever it says.
    await send("menu_more", "text");

    assertEquals(session()?.data?.address, "menu_more");
});
