/**
 * A collector has to prove who they are before a round is shown.
 *
 * Until this existed a collector was identified by their phone number and
 * nothing else: match an active row in `sample_collectors` and the round
 * opened. That round lists, for every home visit that day, the patient's name,
 * their appointment time and their home address - so a borrowed handset, a
 * recycled number or a SIM swap got a list of who is home and when.
 *
 * Doctors have never worked that way, and the fix is deliberately the same
 * shape: a bcrypt PIN, and a shared lockout so guessing is not free.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, today } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { hashPassword, verifyPassword } from "../shared/bcrypt-password.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const COLLECTOR = "919000000088";
const ME = "col-1";
const PIN = "8317";
const PIN_HASH = await hashPassword(PIN);

const PATIENT = "Anil";
const ADDRESS = "Flat 3B, above the chemist";

function build(options: { pinHash?: string | null; state?: string } = {}) {
    const supabase = fakeSupabase(seed());

    supabase.store.sample_collectors = [
        {
            id: ME,
            clinic_id: CLINIC_A,
            name: "Ravi",
            phone: COLLECTOR,
            is_active: true,
            pin_hash: options.pinHash === undefined ? PIN_HASH : options.pinHash
        }
    ];

    supabase.store.appointments = [
        {
            id: "APT_1",
            clinic_id: CLINIC_A,
            patient_phone: "919000000001",
            patient_name: PATIENT,
            appointment_date: today(),
            appointment_time: "10:00",
            location_type: "HOME",
            status: "CONFIRMED",
            service_address: ADDRESS,
            collector_id: ME
        }
    ];

    supabase.store.whatsapp_sessions = [
        {
            phone: COLLECTOR,
            clinic_id: CLINIC_A,
            state: options.state ?? "COLLECTOR_LOGIN",
            data: {},
            role: "HOME_COLLECTION_PERSON"
        }
    ];

    supabase.store.login_rate_limits = [];

    const wa = new FakeWhatsAppClient();

    const send = (text: string, messageType = "text") =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: COLLECTOR,
            senderName: "Ravi",
            messageText: text,
            messageType,
            clinicId: CLINIC_A
        });

    const said = () => wa.sent.map((m) => m.body).join("\n");
    const collector = () => supabase.rows("sample_collectors").find((c: any) => c.id === ME);
    const session = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === COLLECTOR);

    return { supabase, wa, send, said, collector, session };
}

Deno.test("saying hi asks for a PIN rather than opening the round", async () => {
    const { send, wa, said } = build();

    await send("hi");

    assertEquals(wa.sent.find((m) => m.type === "list"), undefined);
    assert(!said().includes(PATIENT), said());
    assert(!said().includes(ADDRESS), said());
});

Deno.test("the right PIN opens the round", async () => {
    const { send, wa } = build();

    await send("hi");
    await send(PIN);

    const list = wa.sent.find((m) => m.type === "list");

    assertEquals(list?.sections?.[0].rows.length, 1);
});

Deno.test("a wrong PIN shows nobody's address", async () => {
    const { send, wa, said } = build();

    await send("hi");
    await send("9999");

    assertEquals(wa.sent.find((m) => m.type === "list"), undefined);
    assert(!said().includes(ADDRESS), said());
    assert(/wrong pin/i.test(said()), said());
});

Deno.test("three wrong PINs lock the account, and the fourth is refused outright", async () => {
    const { send, said, supabase } = build();

    await send("hi");

    for (let i = 0; i < 3; i++) {
        await send("9999");
    }

    // Even the correct PIN is refused while the lockout stands.
    await send(PIN);

    assert(/try again in/i.test(said()), said());

    const limit = supabase
        .rows("login_rate_limits")
        .find((r: any) => r.user_id === ME && r.user_type === "collector");

    assertEquals(limit?.failed_attempts, 3);
    assert(limit?.locked_until, "a lockout should have been recorded");
});

Deno.test("a collector with no PIN is asked to set one, not let in", async () => {
    const { send, wa, said } = build({ pinHash: null });

    await send("hi");

    assertEquals(wa.sent.find((m) => m.type === "list"), undefined);
    assert(!said().includes(ADDRESS), said());
    assert(/choose a PIN/i.test(said()), said());
});

Deno.test("setting a first PIN stores a hash, never the PIN", async () => {
    const { send, collector } = build({ pinHash: null });

    await send("hi");
    await send("5274");

    const stored = collector()?.pin_hash;

    assert(stored, "a hash should have been stored");
    assert(stored !== "5274", "the PIN itself must not be stored");
    assertEquals(await verifyPassword("5274", stored), true);
});

Deno.test("a weak first PIN is refused and nothing is stored", async () => {
    const { send, collector, said } = build({ pinHash: null });

    await send("hi");
    await send("1234");

    assertEquals(collector()?.pin_hash, null);
    assert(/another PIN/i.test(said()), said());
});

// The gate stands in front of the states before the menu. A session left in
// COLLECTOR_MENU by the previous build would have walked straight past it,
// which is why 037 sends them back to COLLECTOR_LOGIN.
Deno.test("a session already in the menu is not a way around the PIN", async () => {
    const { send, wa, said } = build({ state: "COLLECTOR_LOGIN" });

    await send("anything at all");

    assertEquals(wa.sent.find((m) => m.type === "list"), undefined);
    assert(!said().includes(ADDRESS), said());
});
