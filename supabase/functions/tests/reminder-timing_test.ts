/**
 * When a reminder is actually due.
 *
 * Booking at 23:52 for 11:30 the next morning produced a "reminder" one minute
 * later, on a real handset. Two faults in the same line:
 *
 *   `new Date("2026-09-18T11:30:00")` is read as UTC by a runtime whose clock
 *   is UTC, so for Asia/Kolkata the instant was five and a half hours late. The
 *   hour-before reminder for an 11:30 appointment came out at 16:00 local —
 *   after the patient had been and gone.
 *
 *   And a reminder whose time had already passed was still written as PENDING,
 *   so the scheduler, which takes everything with scheduled_time <= now, sent
 *   it on its very next pass.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A } from "./helpers/fixtures.ts";
import { clinicInstant } from "../shared/clinic-slots.ts";
import { createAppointmentReminders } from "../shared/appointment-reminders.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const IST = "Asia/Kolkata";
const APPOINTMENT = "APT_TEST_1";

Deno.test("11:30 in Kolkata is 06:00 UTC, not 11:30 UTC", () => {
    assertEquals(clinicInstant("2026-09-18", "11:30", IST).toISOString(), "2026-09-18T06:00:00.000Z");
});

Deno.test("a UTC clinic is unchanged", () => {
    assertEquals(clinicInstant("2026-09-18", "11:30", "UTC").toISOString(), "2026-09-18T11:30:00.000Z");
});

Deno.test("a zone behind UTC goes the other way", () => {
    assertEquals(
        clinicInstant("2026-09-18", "09:00", "America/New_York").toISOString(),
        "2026-09-18T13:00:00.000Z"
    );
});

function build(date: string, time: string) {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics[0].timezone = IST;
    supabase.store.appointments = [
        {
            id: APPOINTMENT,
            clinic_id: CLINIC_A,
            patient_phone: "919000000001",
            patient_name: "Anil",
            appointment_date: date,
            appointment_time: time
        }
    ];
    supabase.store.appointment_reminders = [];

    return supabase;
}

function reminder(supabase: any, type: string) {
    return supabase.rows("appointment_reminders").find((r: any) => r.reminder_type === type);
}

Deno.test("the hour-before reminder lands an hour before, in the clinic's own time", async () => {
    const supabase = build("2099-09-18", "11:30");

    await createAppointmentReminders(supabase as any, CLINIC_A, APPOINTMENT, "2099-09-18", "11:30");

    // 11:30 IST is 06:00 UTC, so an hour before is 05:00 UTC.
    assertEquals(reminder(supabase, "1_HOUR")?.scheduled_time, "2099-09-18T05:00:00.000Z");
    assertEquals(reminder(supabase, "24_HOUR")?.scheduled_time, "2099-09-17T06:00:00.000Z");
});

Deno.test("a reminder still ahead of us is left to be sent", async () => {
    const supabase = build("2099-09-18", "11:30");

    await createAppointmentReminders(supabase as any, CLINIC_A, APPOINTMENT, "2099-09-18", "11:30");

    assertEquals(reminder(supabase, "24_HOUR")?.status, "PENDING");
    assertEquals(reminder(supabase, "1_HOUR")?.status, "PENDING");
});

Deno.test("booking inside the day does not fire yesterday's reminder now", async () => {
    // Tomorrow, so the 24 hour mark is already behind us but the hour is not.
    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const supabase = build(tomorrow, "23:30");

    await createAppointmentReminders(supabase as any, CLINIC_A, APPOINTMENT, tomorrow, "23:30");

    assertEquals(reminder(supabase, "24_HOUR")?.status, "SKIPPED");
    assertEquals(reminder(supabase, "1_HOUR")?.status, "PENDING");
});

Deno.test("an appointment in the past schedules nothing to send", async () => {
    const supabase = build("2020-01-01", "11:30");

    await createAppointmentReminders(supabase as any, CLINIC_A, APPOINTMENT, "2020-01-01", "11:30");

    assertEquals(reminder(supabase, "24_HOUR")?.status, "SKIPPED");
    assertEquals(reminder(supabase, "1_HOUR")?.status, "SKIPPED");
});
