/**
 * What happens when the patient does not do as they are told.
 *
 * WhatsApp leaves every button tappable forever and every message typable, so
 * none of this is misuse: people scroll up and tap an old button, type "9"
 * when nine options were never offered, and answer a list with a sentence.
 * The existing stale-tap cover is one state deep — BOOK_ADDRESS, because that
 * is where it was caught on a real handset — and the same class of mistake is
 * reachable from every other step of the booking.
 *
 * The failure these guard against is not a crash. It is the quiet one: a
 * number read as an array index that returns undefined, a menu id stored as
 * somebody's name, a sentence accepted as a time. Each would leave a booking
 * that looks real and is wrong.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, DOCTOR_A, PATIENT_PHONE, today } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

function build(state: string, data: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state,
            data: { language: "EN", ...data },
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

Deno.test("a service number nobody was offered re-shows the list", async () => {
    const { send, session, said } = build("SERVICE_SELECT");

    await send("99", "text");

    assertEquals(session()?.state, "SERVICE_SELECT", "must not move on");
    assertEquals(session()?.data?.serviceTypeId, undefined, "nothing may be chosen");
    assert(!/undefined/i.test(said()), `an index miss reached the patient:\n${said()}`);
});

Deno.test("service zero is not the last one in the list", async () => {
    // services[0 - 1] is undefined, but a language that wrapped would hand
    // back the final service instead, which nobody asked for.
    const { send, session } = build("SERVICE_SELECT");

    await send("0", "text");

    assertEquals(session()?.data?.serviceTypeId, undefined);
});

Deno.test("a doctor number nobody was offered is refused, not indexed", async () => {
    const { send, session, said } = build("BOOK_DOCTOR", { serviceTypeId: "svc-consult" });

    await send("99", "text");

    assertEquals(session()?.data?.selectedDoctorId, undefined);
    assertEquals(session()?.state, "BOOK_DOCTOR");
    assert(!/undefined/i.test(said()), `an index miss reached the patient:\n${said()}`);
});

Deno.test("a sentence where a date belongs is refused rather than parsed", async () => {
    const { send, session } = build("BOOK_DATE", {
        selectedDoctorId: DOCTOR_A,
        selectedDoctorName: "Dr A Sharma"
    });

    await send("sometime next week please", "text");

    assertEquals(session()?.state, "BOOK_DATE");
    assertEquals(session()?.data?.selectedDate, undefined);
});

Deno.test("an impossible time is refused rather than booked", async () => {
    const { send, session } = build("BOOK_TIME", {
        selectedDoctorId: DOCTOR_A,
        selectedDate: today()
    });

    await send("25:00", "text");

    assertEquals(session()?.state, "BOOK_TIME");
    assertEquals(session()?.data?.selectedTime, undefined);
});

Deno.test("scrolling up and tapping Book mid-booking starts again rather than being read as input", async () => {
    // The case people describe as "going to the top and tapping the wrong
    // thing". Previously only proven for BOOK_ADDRESS.
    const { send, session } = build("BOOK_TIME", {
        selectedDoctorId: DOCTOR_A,
        selectedDate: today()
    });

    await send(BUTTON_IDS.PATIENT_MENU.BOOK);

    assertEquals(session()?.data?.selectedTime, undefined, "the menu id is not a time");
    assert(
        session()?.state !== "BOOK_TIME",
        "the tap was swallowed by the step instead of reaching the menu"
    );
});

Deno.test("a menu id arriving where a name belongs is not stored as the patient", async () => {
    const { send, session } = build("BOOK_NAME", {
        selectedDoctorId: DOCTOR_A,
        selectedDate: today(),
        selectedTime: "10:00"
    });

    await send(BUTTON_IDS.PATIENT_MENU.CANCEL);

    assertEquals(
        session()?.data?.patientName,
        undefined,
        "a button id was written down as somebody's name"
    );
});

Deno.test("a confirmation the patient never gave does not book", async () => {
    const { send, supabase } = build("BOOK_CONFIRM", {
        selectedDoctorId: DOCTOR_A,
        selectedDate: today(),
        selectedTime: "10:00",
        patientName: "Anil"
    });

    await send("maybe", "text");

    assertEquals(
        supabase.rows("appointments").length,
        0,
        "free text was taken as a yes"
    );
});
