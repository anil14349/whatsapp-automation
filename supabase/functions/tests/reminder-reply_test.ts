/**
 * Replying to a reminder in words.
 *
 * The 24 hour reminder asks the patient to reply CANCEL or RESCHEDULE. There
 * was no keyword handling, so a typed word fell through to the generic menu —
 * which opens by offering to book *another* appointment and hides cancelling
 * behind "More Options". The invitation was not one the bot could honour.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, PATIENT_PHONE, tomorrow } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

function build(role = "PATIENT") {
    const supabase = fakeSupabase(seed());

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state: role === "DOCTOR" ? "DOCTOR_MENU" : "MAIN_MENU",
            data: { language: "EN", authenticated: true },
            role
        }
    ];

    supabase.store.appointments = [
        {
            id: "APT_KEYWORD_1",
            clinic_id: CLINIC_A,
            patient_phone: PATIENT_PHONE,
            patient_name: "Anil",
            service_type_id: "svc-consult",
            appointment_date: tomorrow(),
            appointment_time: "10:00",
            status: "CONFIRMED",
            // The fake ignores select(), so the embed is shaped on the row.
            doctor: { name: "A Sharma" }
        }
    ];

    const wa = new FakeWhatsAppClient();

    const send = (text: string) =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: PATIENT_PHONE,
            senderName: "Anil",
            messageText: text,
            messageType: "text",
            clinicId: CLINIC_A
        });

    const session = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { send, session, said };
}

Deno.test("typing cancel reaches the cancel flow, not the booking menu", async () => {
    const { send, session, said } = build();

    await send("cancel");

    // One appointment, so it goes straight to confirming that one.
    assertEquals(session()?.state, "CANCEL_CONFIRM");
    assert(!/Book Appointment/i.test(said()), said());
});

Deno.test("typing reschedule reaches the reschedule flow", async () => {
    const { send, session } = build();

    await send("reschedule");

    assertEquals(session()?.state, "RESCHEDULE_DATE");
});

Deno.test("case and stray spacing do not matter", async () => {
    const { send, session } = build();

    await send("  CANCEL  ");

    assertEquals(session()?.state, "CANCEL_CONFIRM");
});

Deno.test("the Hindi words work too", async () => {
    const { send, session } = build();

    await send("रद्द");

    assertEquals(session()?.state, "CANCEL_CONFIRM");
});

Deno.test("a sentence containing the word is not treated as the command", async () => {
    // Only an exact word is a command, so "I cannot cancel my plans" does not
    // silently start cancelling an appointment.
    const { send, session } = build();

    await send("sorry I could not cancel my other plans");

    assertEquals(session()?.state, "MAIN_MENU");
});

Deno.test("a doctor typing cancel is not sent to the patient flow", async () => {
    const { send, session } = build("DOCTOR");

    await send("cancel");

    assertEquals(session()?.state, "DOCTOR_MENU");
});

Deno.test("the template's quick reply labels are words the bot understands", async () => {
    // A template quick reply arrives carrying the button's own label, so
    // "Cancel" has to reach the cancel flow exactly as a typed word would.
    const { send, session } = build();

    await send("Cancel");

    assertEquals(session()?.state, "CANCEL_CONFIRM");
});

Deno.test("the Reschedule label reaches the reschedule flow", async () => {
    const { send, session } = build();

    await send("Reschedule");

    assertEquals(session()?.state, "RESCHEDULE_DATE");
});
