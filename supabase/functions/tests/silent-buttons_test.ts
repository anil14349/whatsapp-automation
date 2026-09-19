/**
 * Two buttons that did nothing at all.
 *
 * Both were found by the combinatorial sweep rather than by thinking of them,
 * which is the point: neither is an obvious case, and both leave the patient
 * staring at a conversation that has stopped answering. That is worse than an
 * error, because there is nothing to react to — no retry, no explanation, and
 * no reason to believe a second tap will do any better.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, today, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

function build(state: string, data: Record<string, unknown>) {
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

    const send = (text: string) =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: PATIENT_PHONE,
            senderName: "Sim",
            messageText: text,
            messageType: "interactive",
            clinicId: CLINIC_A
        });

    const session = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    return { supabase, wa, send, session };
}

Deno.test("asking for more times when none are left answers instead of going quiet", async () => {
    const { send, wa, session } = build("BOOK_TIME", {
        selectedDoctorId: DOCTOR_A,
        selectedDoctorName: "Dr A Sharma",
        selectedDate: today(),
        locationType: "CLINIC",
        slotPage: 0
    });

    await send(BUTTON_IDS.PAGINATION.MORE_SLOTS);

    assert(wa.sent.length > 0, "the patient tapped More times and heard nothing back");
    assertEquals(session()?.state, "BOOK_DATE", "and was left with no way to continue");
});

Deno.test("the same tap while rescheduling goes back to the reschedule date, not the booking one", async () => {
    const { send, wa, session } = build("RESCHEDULE_TIME", {
        selectedDoctorId: DOCTOR_A,
        rescheduleAppointmentId: "APT_X",
        newDate: today(),
        slotPage: 0
    });

    await send(BUTTON_IDS.PAGINATION.MORE_SLOTS);

    assert(wa.sent.length > 0);
    assert(
        session()?.state !== "BOOK_TIME",
        "a reschedule fell through into the booking flow"
    );
});

Deno.test("Back at the waitlist offer answers instead of going quiet", async () => {
    // go_back is in BUTTON_IDS.CONFIRMATION, so it passed the guard that only
    // lets confirmation buttons through, then matched neither Yes nor No and
    // fell out of the function having sent nothing.
    const { send, wa, session } = build("WAITLIST_CONFIRM", {
        doctorId: DOCTOR_A,
        doctorName: "Dr A Sharma",
        date: today(),
        time: "ANY"
    });

    await send(BUTTON_IDS.CONFIRMATION.BACK);

    assert(wa.sent.length > 0, "the patient tapped Back and heard nothing back");
    assertEquals(session()?.state, "BOOK_DATE");
});

Deno.test("No at the waitlist offer still works", async () => {
    const { send, wa, session } = build("WAITLIST_CONFIRM", {
        doctorId: DOCTOR_A,
        doctorName: "Dr A Sharma",
        date: today(),
        time: "ANY"
    });

    await send(BUTTON_IDS.CONFIRMATION.NO);

    assert(wa.sent.length > 0);
    assertEquals(session()?.state, "BOOK_DATE");
});

Deno.test("Yes at the waitlist offer still joins the waitlist", async () => {
    const { send, supabase } = build("WAITLIST_CONFIRM", {
        doctorId: DOCTOR_A,
        doctorName: "Dr A Sharma",
        date: today(),
        time: "ANY"
    });

    await send(BUTTON_IDS.CONFIRMATION.YES);

    assertEquals(
        supabase.rows("waitlist").length,
        1,
        "the catch-all swallowed the one button that does something"
    );
});

// The doctor flow had the same hole in both of its confirmations.

function doctorAt(state: string) {
    const supabase = fakeSupabase(seed());
    const phone = "919712200001";

    supabase.store.doctors[0].phone = phone;

    supabase.store.whatsapp_sessions = [
        {
            phone,
            clinic_id: CLINIC_A,
            state,
            data: {
                authenticated: true,
                doctorId: DOCTOR_A,
                doctorName: "Dr A Sharma",
                clinicId: CLINIC_A,
                availabilityStart: "09:00",
                availabilityEnd: "17:00",
                availabilityDay: 1,
                leaveStart: today(),
                leaveEnd: today()
            },
            role: "DOCTOR"
        }
    ];

    const wa = new FakeWhatsAppClient();

    const send = (text: string) =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: phone,
            senderName: "Dr A",
            messageText: text,
            messageType: "interactive",
            clinicId: CLINIC_A
        });

    return { supabase, wa, send };
}

Deno.test("Back at the hours confirmation answers instead of going quiet", async () => {
    const { send, wa } = doctorAt("DOCTOR_AVAILABILITY_CONFIRM");

    await send(BUTTON_IDS.CONFIRMATION.BACK);

    assert(wa.sent.length > 0, "the doctor tapped Back and heard nothing back");
});

Deno.test("Back at the leave confirmation answers instead of going quiet", async () => {
    const { send, wa } = doctorAt("DOCTOR_LEAVE_CONFIRM");

    await send(BUTTON_IDS.CONFIRMATION.BACK);

    assert(wa.sent.length > 0, "the doctor tapped Back and heard nothing back");
});

Deno.test("Yes at the hours confirmation still saves them", async () => {
    const { send, supabase } = doctorAt("DOCTOR_AVAILABILITY_CONFIRM");

    await send(BUTTON_IDS.CONFIRMATION.YES);

    assertEquals(
        supabase.rows("doctor_operating_hours").length,
        1,
        "the catch-all swallowed the button that does the work"
    );
});
