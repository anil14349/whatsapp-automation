/**
 * What counts as an upcoming appointment.
 *
 * "Upcoming" excluded cancelled appointments but not completed ones, and the
 * date filter is by day, so a visit finished at 3:56 pm was still listed at
 * 4:00 pm that afternoon. Seen on a real handset: the patient was offered
 * "Cancel this appointment?" for a consultation they had already attended,
 * minutes after being sent the feedback survey for it.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";
import { MultiClinicSupabaseClient } from "../shared/multi-clinic-supabase-client.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const IST = "Asia/Kolkata";

function today(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}

function build(statuses: string[]) {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics = [{ id: CLINIC_A, name: "Clinic A", timezone: IST }];

    supabase.store.appointments = statuses.map((status, index) => ({
        id: `APT_${status}_${index}`,
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_phone: PATIENT_PHONE,
        patient_name: "Anil",
        // Same day as the visit that was wrongly offered, which is the point:
        // the date filter alone cannot tell it has already happened.
        appointment_date: today(),
        appointment_time: "16:00",
        status
    }));

    clearClinicTimezoneCache();

    const client = new MultiClinicSupabaseClient(
        "http://localhost:54321",
        "test-key",
        supabase as any
    );

    return { supabase, client };
}

Deno.test("a completed visit is not upcoming", async () => {
    const { client } = build(["COMPLETED"]);

    const upcoming = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, true);

    assertEquals(upcoming.length, 0, "a finished visit was offered as upcoming");
});

Deno.test("a no-show is not upcoming either", async () => {
    const { client } = build(["NO_SHOW"]);

    const upcoming = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, true);

    assertEquals(upcoming.length, 0);
});

Deno.test("a cancelled appointment stays out", async () => {
    const { client } = build(["CANCELLED"]);

    const upcoming = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, true);

    assertEquals(upcoming.length, 0);
});

Deno.test("a confirmed appointment is still upcoming", async () => {
    // The control: without it the three above would be satisfied by a filter
    // that removed everything.
    const { client } = build(["CONFIRMED"]);

    const upcoming = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, true);

    assertEquals(upcoming.length, 1);
    assertEquals(upcoming[0].status, "CONFIRMED");
});

Deno.test("a rescheduled appointment is still upcoming", async () => {
    const { client } = build(["RESCHEDULED"]);

    const upcoming = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, true);

    assertEquals(upcoming.length, 1);
});

Deno.test("only the live one survives a mixed day", async () => {
    const { client } = build(["COMPLETED", "CONFIRMED", "CANCELLED", "NO_SHOW"]);

    const upcoming = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, true);

    assertEquals(upcoming.length, 1);
    assertEquals(upcoming[0].status, "CONFIRMED");
});

Deno.test("the history view still shows everything", async () => {
    // upcomingOnly=false is how a patient reads back what has happened, so
    // narrowing the upcoming list must not narrow that too.
    const { client } = build(["COMPLETED", "CONFIRMED", "CANCELLED"]);

    const all = await client.getPatientAppointments(CLINIC_A, PATIENT_PHONE, false);

    assertEquals(all.length, 3);
    assert(all.some((a: any) => a.status === "COMPLETED"), "history lost the completed visit");
});
