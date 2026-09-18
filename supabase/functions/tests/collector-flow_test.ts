/**
 * The sample collector's own flow.
 *
 * What they had was the patient's request flow: saying "hi" asked the
 * collector to book a home collection for themselves, took a typed address
 * with no distance check, and wrote it to a table no screen reads. It served
 * a patient path that no longer exists, so it is gone.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, CLINIC_B, today } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { visitButtonId } from "../shared/handlers/collector-handler.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const COLLECTOR = "919000000088";

function visit(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        clinic_id: CLINIC_A,
        patient_phone: "919000000001",
        patient_name: "Anil",
        appointment_date: today(),
        appointment_time: "10:00",
        location_type: "HOME",
        status: "CONFIRMED",
        service_address: "Flat 3B, above the chemist",
        ...overrides
    };
}

function build(appointments: Record<string, unknown>[], state = "COLLECTOR_MENU") {
    const supabase = fakeSupabase(seed());

    supabase.store.sample_collectors = [
        { id: "col-1", clinic_id: CLINIC_A, name: "Ravi", phone: COLLECTOR, is_active: true }
    ];

    supabase.store.appointments = appointments;

    supabase.store.whatsapp_sessions = [
        {
            phone: COLLECTOR,
            clinic_id: CLINIC_A,
            state,
            data: {},
            role: "HOME_COLLECTION_PERSON"
        }
    ];

    const wa = new FakeWhatsAppClient();

    const send = (text: string, messageType = "interactive") =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: COLLECTOR,
            senderName: "Ravi",
            messageText: text,
            messageType,
            clinicId: CLINIC_A
        });

    const session = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === COLLECTOR);

    const appointment = (id: string) =>
        supabase.rows("appointments").find((a: any) => a.id === id);

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, send, session, appointment, said };
}

Deno.test("a collector is shown today's visits, not asked to book one", async () => {
    const { send, wa, said } = build([visit("APT_1")]);

    await send("hi", "text");

    const list = wa.sent.find((m) => m.type === "list");

    assertEquals(list?.sections?.[0].rows.length, 1);
    assert(!/share your location/i.test(said()), said());
    assert(!/type your address/i.test(said()), said());
});

Deno.test("only home visits appear, not clinic appointments", async () => {
    const { send, wa } = build([
        visit("APT_HOME"),
        visit("APT_CLINIC", { location_type: "CLINIC", service_address: null })
    ]);

    await send("hi", "text");

    const list = wa.sent.find((m) => m.type === "list");

    assertEquals(list?.sections?.[0].rows.map((r) => r.id), [visitButtonId("APT_HOME")]);
});

Deno.test("another clinic's visit is never listed", async () => {
    const { send, wa } = build([
        visit("APT_MINE"),
        visit("APT_THEIRS", { clinic_id: CLINIC_B })
    ]);

    await send("hi", "text");

    const list = wa.sent.find((m) => m.type === "list");

    assertEquals(list?.sections?.[0].rows.map((r) => r.id), [visitButtonId("APT_MINE")]);
});

Deno.test("an empty day says so rather than showing nothing", async () => {
    const { send, said } = build([]);

    await send("hi", "text");

    assert(/No home collections booked for today/i.test(said()), said());
});

Deno.test("choosing a visit asks before closing it", async () => {
    const { send, session, appointment } = build([visit("APT_1")]);

    await send(visitButtonId("APT_1"));

    assertEquals(session()?.state, "COLLECTOR_CONFIRM");
    assertEquals(appointment("APT_1")?.status, "CONFIRMED");
});

Deno.test("confirming marks the appointment collected", async () => {
    const { send, appointment } = build(
        [visit("APT_1")],
        "COLLECTOR_CONFIRM"
    );

    // The session carries the choice, as it would after the list tap.
    const { supabase } = build([visit("APT_1")]);
    supabase.store.whatsapp_sessions[0].state = "COLLECTOR_CONFIRM";
    supabase.store.whatsapp_sessions[0].data = { selectedVisitId: "APT_1" };

    await processMessage(supabase as any, new FakeWhatsAppClient() as any, {
        messageId: crypto.randomUUID(),
        senderPhone: COLLECTOR,
        senderName: "Ravi",
        messageText: BUTTON_IDS.CONFIRMATION.YES,
        messageType: "interactive",
        clinicId: CLINIC_A
    });

    const row = supabase.rows("appointments").find((a: any) => a.id === "APT_1");
    assertEquals(row?.status, "COMPLETED");
});

Deno.test("declining leaves the visit alone", async () => {
    const { supabase } = build([visit("APT_1")]);
    supabase.store.whatsapp_sessions[0].state = "COLLECTOR_CONFIRM";
    supabase.store.whatsapp_sessions[0].data = { selectedVisitId: "APT_1" };

    await processMessage(supabase as any, new FakeWhatsAppClient() as any, {
        messageId: crypto.randomUUID(),
        senderPhone: COLLECTOR,
        senderName: "Ravi",
        messageText: BUTTON_IDS.CONFIRMATION.NO,
        messageType: "interactive",
        clinicId: CLINIC_A
    });

    const row = supabase.rows("appointments").find((a: any) => a.id === "APT_1");
    assertEquals(row?.status, "CONFIRMED");
});

Deno.test("a visit id from another clinic cannot be closed", async () => {
    const { supabase } = build([visit("APT_THEIRS", { clinic_id: CLINIC_B })]);
    supabase.store.whatsapp_sessions[0].state = "COLLECTOR_CONFIRM";
    supabase.store.whatsapp_sessions[0].data = { selectedVisitId: "APT_THEIRS" };

    await processMessage(supabase as any, new FakeWhatsAppClient() as any, {
        messageId: crypto.randomUUID(),
        senderPhone: COLLECTOR,
        senderName: "Ravi",
        messageText: BUTTON_IDS.CONFIRMATION.YES,
        messageType: "interactive",
        clinicId: CLINIC_A
    });

    const row = supabase.rows("appointments").find((a: any) => a.id === "APT_THEIRS");
    assertEquals(row?.status, "CONFIRMED");
});
