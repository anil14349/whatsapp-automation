/**
 * Cancelling and rescheduling.
 *
 * These are now reachable over REST, so an appointment id alone must never be
 * enough: without a clinic filter one clinic's staff could cancel another's
 * bookings by guessing ids.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B, DOCTOR_A, tomorrow } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { cancelAppointment, rescheduleAppointment } = await import("../shared/appointments.ts");

function withAppointment() {
    const supabase = fakeSupabase(seed());

    supabase.store.appointments = [
        {
            id: "APT_TEST_1",
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: "919000000001",
            patient_name: "Test Patient",
            appointment_date: tomorrow(),
            appointment_time: "10:00",
            status: "CONFIRMED"
        }
    ];

    return supabase;
}

Deno.test("an appointment can be cancelled by its own clinic", async () => {
    const supabase = withAppointment();

    const result = await cancelAppointment(supabase, "APT_TEST_1", CLINIC_A, "no longer needed");

    assertEquals(result.success, true);
    assertEquals(supabase.rows("appointments")[0].status, "CANCELLED");
});

Deno.test("another clinic cannot cancel it", async () => {
    const supabase = withAppointment();

    const result = await cancelAppointment(supabase, "APT_TEST_1", CLINIC_B, "malicious");

    assertEquals(result.success, false);
    assertEquals(
        supabase.rows("appointments")[0].status,
        "CONFIRMED",
        "another clinic changed this appointment"
    );
});

Deno.test("cancelling twice is refused", async () => {
    const supabase = withAppointment();

    await cancelAppointment(supabase, "APT_TEST_1", CLINIC_A);
    const second = await cancelAppointment(supabase, "APT_TEST_1", CLINIC_A);

    assertEquals(second.success, false);
});

Deno.test("a completed appointment cannot be cancelled", async () => {
    const supabase = withAppointment();
    supabase.store.appointments[0].status = "COMPLETED";

    const result = await cancelAppointment(supabase, "APT_TEST_1", CLINIC_A);

    assertEquals(result.success, false);
});

Deno.test("an unknown appointment is reported, not silently ignored", async () => {
    const supabase = withAppointment();

    const result = await cancelAppointment(supabase, "APT_DOES_NOT_EXIST", CLINIC_A);

    assertEquals(result.success, false);
});

Deno.test("the cancelling actor is recorded", async () => {
    const supabase = withAppointment();

    await cancelAppointment(supabase, "APT_TEST_1", CLINIC_A, "double booked", "receptionist:a@b.c");

    const events = supabase.rows("audit_log");

    assertEquals(events[0].action, "appointment_cancelled");
    assertEquals(events[0].actor, "receptionist:a@b.c");
});

Deno.test("another clinic cannot reschedule it", async () => {
    const supabase = withAppointment();

    const result = await rescheduleAppointment(
        supabase,
        "APT_TEST_1",
        CLINIC_B,
        tomorrow(),
        "11:00"
    );

    assertEquals(result.success, false);
    assertEquals(supabase.rows("appointments")[0].appointment_time, "10:00");
});

Deno.test("rescheduling rejects a malformed date or time", async () => {
    const supabase = withAppointment();

    assertEquals(
        (await rescheduleAppointment(supabase, "APT_TEST_1", CLINIC_A, "15-09-2026", "11:00")).success,
        false
    );
    assertEquals(
        (await rescheduleAppointment(supabase, "APT_TEST_1", CLINIC_A, tomorrow(), "25:00")).success,
        false
    );
});

Deno.test("a cancelled appointment cannot be rescheduled", async () => {
    const supabase = withAppointment();
    supabase.store.appointments[0].status = "CANCELLED";

    const result = await rescheduleAppointment(
        supabase,
        "APT_TEST_1",
        CLINIC_A,
        tomorrow(),
        "11:00"
    );

    assertEquals(result.success, false);
});
