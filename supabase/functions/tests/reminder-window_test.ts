/**
 * The reminder scheduler, end to end, against a closed 24 hour window.
 *
 * proactive_test.ts covers the fallback in isolation. This covers the thing
 * that was actually broken in production: a reminder for a booking made days
 * earlier, where the patient has not messaged since, and the row's fate
 * afterwards. Before the fix the send was refused, the row went back to PENDING
 * and was retried against the same closed window until its attempts ran out.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { runReminderScheduler } from "../shared/appointment-reminder-scheduler.ts";
import { WhatsAppApiError } from "../shared/whatsapp-client.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const APPOINTMENT = "APT_20260918_TEST01";
const REMINDER = "rrrrrrrr-0000-0000-0000-000000000001";

function build() {
    const supabase = fakeSupabase({
        clinics: [{ id: CLINIC_A, name: "Clinic A", is_active: true, timezone: "Asia/Kolkata" }],
        doctors: [{ id: DOCTOR_A, clinic_id: CLINIC_A, name: "A Sharma", is_active: true }],
        appointments: [
            {
                id: APPOINTMENT,
                clinic_id: CLINIC_A,
                doctor_id: DOCTOR_A,
                patient_name: "Asha Rao",
                patient_phone: PATIENT_PHONE,
                appointment_date: "2026-09-18",
                appointment_time: "10:30",
                status: "CONFIRMED",
                preferred_language: "EN"
            }
        ],
        appointment_reminders: [
            {
                id: REMINDER,
                clinic_id: CLINIC_A,
                appointment_id: APPOINTMENT,
                patient_phone: PATIENT_PHONE,
                reminder_type: "24_HOUR",
                // Already due: the scheduler only picks up reminders whose time
                // has passed.
                scheduled_time: "2020-01-01T05:00:00.000Z",
                status: "PENDING",
                attempts: 0,
                max_attempts: 3
            }
        ]
    });

    const wa = new FakeWhatsAppClient();

    return { supabase, wa };
}

function reminderRow(supabase: any) {
    return supabase.rows("appointment_reminders").find((r: any) => r.id === REMINDER);
}

const closedWindow = () =>
    new WhatsAppApiError(
        "WhatsApp API error: Message failed to send because more than 24 hours have passed",
        131047
    );

Deno.test("a reminder for a patient who has not written in days still reaches them", async () => {
    const { supabase, wa } = build();
    wa.textError = closedWindow();

    const result = await runReminderScheduler(supabase as any, wa, { clinicIds: [CLINIC_A] });

    assertEquals(result.reminders_sent, 1);
    assertEquals(result.reminders_failed, 0);

    const template = wa.sent.find((m) => m.type === "template");

    assertEquals(template?.body, "appointment_reminder_24h");
    assertEquals(reminderRow(supabase)?.status, "SENT");
});

Deno.test("a reminder inside the window is still sent as an ordinary message", async () => {
    const { supabase, wa } = build();

    const result = await runReminderScheduler(supabase as any, wa, { clinicIds: [CLINIC_A] });

    assertEquals(result.reminders_sent, 1);
    assertEquals(wa.sent.filter((m) => m.type === "template").length, 0);
    assertEquals(reminderRow(supabase)?.status, "SENT");
});

Deno.test("an unregistered template fails the reminder once, not three times", async () => {
    const { supabase, wa } = build();
    wa.textError = closedWindow();
    wa.templateError = new WhatsAppApiError("Template name does not exist", 132001);

    const result = await runReminderScheduler(supabase as any, wa, { clinicIds: [CLINIC_A] });

    assertEquals(result.reminders_sent, 0);
    assertEquals(result.reminders_failed, 1);

    const row = reminderRow(supabase);

    assertEquals(row?.status, "FAILED", "it must not go back to PENDING to be retried");
    assertEquals(row?.attempts, 1, "retrying a template Meta lacks would waste two more");
});

Deno.test("a transient failure is left to be retried", async () => {
    const { supabase, wa } = build();
    wa.textError = new WhatsAppApiError("Service temporarily unavailable", 500);

    const result = await runReminderScheduler(supabase as any, wa, { clinicIds: [CLINIC_A] });

    assertEquals(result.reminders_failed, 1);

    const row = reminderRow(supabase);

    assertEquals(row?.status, "PENDING", "a blip should be tried again");
    assertEquals(row?.attempts, 1);
});
