/**
 * Reminders have to follow the appointment they belong to.
 *
 * Found by clicking through the portal on 2026-09-18. Cancelling a visit at the
 * desk left both reminders PENDING, so the scheduler would still have told the
 * patient about a visit that was no longer happening. Moving one left its
 * reminders pointing at the old slot. Marking somebody Visited left the
 * hour-before reminder to go out after they had been and gone.
 *
 * The rule lived in the WhatsApp handler, so only the WhatsApp flow obeyed it.
 * It now lives in cancelAppointment / rescheduleAppointment, where every caller
 * gets it.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { cancelAppointment } from "../shared/appointments.ts";
import {
    rescheduleAppointmentReminders,
    skipAppointmentReminders
} from "../shared/appointment-reminders.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const IST = "Asia/Kolkata";
const APPOINTMENT = "APT_LIFECYCLE_1";

/** Far enough out that both reminders are still ahead of us. */
const FUTURE_DATE = "2099-09-18";
const FUTURE_TIME = "11:30";

function build(status = "CONFIRMED") {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics[0].timezone = IST;
    supabase.store.appointments = [
        {
            id: APPOINTMENT,
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: "919000000001",
            patient_name: "Anil",
            appointment_date: FUTURE_DATE,
            appointment_time: FUTURE_TIME,
            status
        }
    ];
    supabase.store.appointment_reminders = [
        {
            id: "rem-24",
            clinic_id: CLINIC_A,
            appointment_id: APPOINTMENT,
            patient_phone: "919000000001",
            reminder_type: "24_HOUR",
            scheduled_time: "2099-09-17T06:00:00.000Z",
            status: "PENDING",
            attempts: 0
        },
        {
            id: "rem-1",
            clinic_id: CLINIC_A,
            appointment_id: APPOINTMENT,
            patient_phone: "919000000001",
            reminder_type: "1_HOUR",
            scheduled_time: "2099-09-18T05:00:00.000Z",
            status: "PENDING",
            attempts: 0
        }
    ];

    const reminder = (type: string) =>
        supabase.rows("appointment_reminders").find((r: any) => r.reminder_type === type);

    return { supabase, reminder };
}

Deno.test("cancelling stops both reminders", async () => {
    const { supabase, reminder } = build();

    await cancelAppointment(supabase as any, APPOINTMENT, CLINIC_A, "changed plans");

    assertEquals(reminder("24_HOUR")?.status, "SKIPPED");
    assertEquals(reminder("1_HOUR")?.status, "SKIPPED");
});

Deno.test("a reminder already sent stays sent when the visit is cancelled", async () => {
    const { supabase, reminder } = build();
    supabase.store.appointment_reminders[0].status = "SENT";

    await cancelAppointment(supabase as any, APPOINTMENT, CLINIC_A);

    // It happened. Rewriting it would lose the only record of the message.
    assertEquals(reminder("24_HOUR")?.status, "SENT");
    assertEquals(reminder("1_HOUR")?.status, "SKIPPED");
});

Deno.test("moving an appointment moves its reminders with it", async () => {
    const { supabase, reminder } = build();

    await rescheduleAppointmentReminders(
        supabase as any,
        CLINIC_A,
        APPOINTMENT,
        "2099-09-20",
        "16:00"
    );

    // 16:00 IST is 10:30 UTC.
    assertEquals(reminder("1_HOUR")?.scheduled_time, "2099-09-20T09:30:00.000Z");
    assertEquals(reminder("24_HOUR")?.scheduled_time, "2099-09-19T10:30:00.000Z");
    assertEquals(reminder("1_HOUR")?.status, "PENDING");
});

Deno.test("a reminder sent for the old time is reset for the new one", async () => {
    const { supabase, reminder } = build();
    supabase.store.appointment_reminders[0].status = "SENT";
    supabase.store.appointment_reminders[0].sent_at = "2026-09-18T10:00:00.000Z";
    supabase.store.appointment_reminders[0].attempts = 1;

    await rescheduleAppointmentReminders(
        supabase as any,
        CLINIC_A,
        APPOINTMENT,
        "2099-09-20",
        "16:00"
    );

    // It described a time that no longer applies, so the new time needs its own.
    assertEquals(reminder("24_HOUR")?.status, "PENDING");
    assertEquals(reminder("24_HOUR")?.sent_at, null);
    assertEquals(reminder("24_HOUR")?.attempts, 0);
});

Deno.test("moving to a time inside the day does not fire the day-before reminder now", async () => {
    const { supabase, reminder } = build();
    const soon = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: IST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(soon);
    const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

    await rescheduleAppointmentReminders(
        supabase as any,
        CLINIC_A,
        APPOINTMENT,
        `${part("year")}-${part("month")}-${part("day")}`,
        `${part("hour")}:${part("minute")}`
    );

    assertEquals(reminder("24_HOUR")?.status, "SKIPPED");
    assertEquals(reminder("1_HOUR")?.status, "PENDING");
});

// rescheduleAppointment's own wiring is not covered here: it calls
// isSlotAvailable, which the fake cannot satisfy without recreating a doctor's
// whole diary. Cancelling exercises the same "shared function owns the rule"
// path, and the move was checked against the live portal.

Deno.test("another clinic cannot move this appointment's reminders", async () => {
    const { supabase, reminder } = build();

    await rescheduleAppointmentReminders(
        supabase as any,
        "00000000-0000-0000-0000-00000000beef",
        APPOINTMENT,
        "2099-09-20",
        "16:00"
    );

    assertEquals(reminder("1_HOUR")?.scheduled_time, "2099-09-18T05:00:00.000Z");
});

Deno.test("marking someone seen stops the hour-before reminder", async () => {
    const { supabase, reminder } = build();

    await skipAppointmentReminders(supabase as any, APPOINTMENT);

    assertEquals(reminder("1_HOUR")?.status, "SKIPPED");
});
