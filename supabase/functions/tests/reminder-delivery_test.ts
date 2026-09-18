/**
 * A reminder Meta accepted and then dropped.
 *
 * Found on 2026-09-18 by booking on the test number, making the reminder due
 * and watching it go PENDING -> SENT with a real message id while Meta's own
 * status callback recorded `delivery: failed, 131047` against that same id.
 * The desk, the row and every report said the patient had been reminded. The
 * patient's handset was silent.
 *
 * The template fallback could never have covered this: it hangs off a thrown
 * error, and nothing throws when Meta accepts the message and changes its mind
 * afterwards.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A } from "./helpers/fixtures.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { recordReminderDelivery } from "../shared/delivery-status.ts";
import { sendProactive } from "../shared/proactive.ts";

const MESSAGE_ID = "wamid.ACCEPTED_THEN_DROPPED";
const PHONE = "919000000001";

const OUTSIDE_WINDOW = [
    {
        code: 131047,
        title: "Re-engagement message",
        detail: "Message failed to send because more than 24 hours have passed."
    }
];

function build(overrides: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());

    supabase.store.appointment_reminders = [
        {
            id: "rem-1",
            clinic_id: CLINIC_A,
            appointment_id: "APT_1",
            patient_phone: PHONE,
            reminder_type: "1_HOUR",
            scheduled_time: "2026-09-19T05:00:00.000Z",
            status: "SENT",
            message_id: MESSAGE_ID,
            attempts: 1,
            max_attempts: 3,
            force_template: false,
            ...overrides
        }
    ];

    return supabase;
}

const only = (supabase: ReturnType<typeof build>) => supabase.store.appointment_reminders[0];

Deno.test("a reminder Meta later reports as failed does not stay SENT", async () => {
    const supabase = build();

    const result = await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "failed", OUTSIDE_WINDOW);

    assertEquals(result.found, true);
    assertEquals(only(supabase).status, "PENDING");
});

Deno.test("the retry is marked to go out as the template, not the same free-form", async () => {
    const supabase = build();

    await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "failed", OUTSIDE_WINDOW);

    assertEquals(only(supabase).force_template, true);
});

Deno.test("the retry is due immediately rather than at a time already gone by", async () => {
    const supabase = build();

    await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "failed", OUTSIDE_WINDOW);

    const due = new Date(String(only(supabase).scheduled_time)).getTime();

    assertEquals(due <= Date.now(), true);
});

Deno.test("Meta's own reason is kept, so the desk is told why", async () => {
    const supabase = build();

    await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "failed", OUTSIDE_WINDOW);

    assertEquals(
        only(supabase).error_message,
        "Message failed to send because more than 24 hours have passed."
    );
});

Deno.test("out of attempts it is FAILED, not retried forever", async () => {
    const supabase = build({ attempts: 3, max_attempts: 3 });

    const result = await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "failed", OUTSIDE_WINDOW);

    assertEquals(result.retrying, false);
    assertEquals(only(supabase).status, "FAILED");
    assertEquals(only(supabase).force_template, false);
});

Deno.test("a delivered report leaves the reminder alone", async () => {
    const supabase = build();

    const result = await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "delivered", undefined);

    assertEquals(result.found, false);
    assertEquals(only(supabase).status, "SENT");
});

Deno.test("a failure for somebody else's message leaves the reminder alone", async () => {
    const supabase = build();

    const result = await recordReminderDelivery(supabase, CLINIC_A, "wamid.SOMETHING_ELSE", "failed", OUTSIDE_WINDOW);

    assertEquals(result.found, false);
    assertEquals(only(supabase).status, "SENT");
});

Deno.test("another clinic's webhook cannot move this clinic's reminder", async () => {
    const supabase = build();

    const result = await recordReminderDelivery(
        supabase,
        "clinic-somebody-else",
        MESSAGE_ID,
        "failed",
        OUTSIDE_WINDOW
    );

    assertEquals(result.found, false);
    assertEquals(only(supabase).status, "SENT");
});

Deno.test("a reminder already moved off SENT is not dragged back", async () => {
    const supabase = build({ status: "SKIPPED" });

    await recordReminderDelivery(supabase, CLINIC_A, MESSAGE_ID, "failed", OUTSIDE_WINDOW);

    assertEquals(only(supabase).status, "SKIPPED");
});

Deno.test("the flagged retry goes straight to the template and spends no free-form send", async () => {
    const wa = new FakeWhatsAppClient();

    const result = await sendProactive(
        wa,
        PHONE,
        "Reminder: 11:30 today",
        { key: "appointment_reminder_1h", parameters: ["Asha", "Dr Kumar", "11:30"] },
        { buttons: [{ id: "cancel", title: "Cancel" }], forceTemplate: true }
    );

    assertEquals(result.delivered, true);
    assertEquals(result.via, "template");
    assertEquals(wa.sent.length, 1);
    assertEquals(wa.sent[0].type, "template");
});

Deno.test("forcing the template with none registered fails rather than sending nothing", async () => {
    const wa = new FakeWhatsAppClient();

    const result = await sendProactive(wa, PHONE, "Reminder: 11:30 today", null, {
        forceTemplate: true
    });

    assertEquals(result.delivered, false);
    assertEquals(result.reason, "outside_window");
    assertEquals(wa.sent.length, 0);
});
