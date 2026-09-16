/**
 * Finding a patient's booking without knowing its date.
 *
 * The important one here is tenant isolation. A search is the first feature
 * that reads appointments without naming a date, so a forgotten clinic filter
 * would quietly hand one clinic another's patient list — and the query looks
 * perfectly correct either way.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { CLINIC_A, CLINIC_B, DOCTOR_A } from "./helpers/fixtures.ts";
import {
    looksLikePhone,
    searchAppointments,
    SEARCH_LIMIT
} from "../shared/appointment-search.ts";

function appointment(over: Record<string, unknown>) {
    return {
        id: crypto.randomUUID(),
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_name: "Someone",
        patient_phone: "919000000001",
        appointment_date: "2026-09-16",
        appointment_time: "10:00",
        status: "CONFIRMED",
        ...over
    };
}

function store() {
    return fakeSupabase({
        appointments: [
            appointment({
                patient_name: "Asha Sharma",
                patient_phone: "919876500011",
                appointment_date: "2026-09-14",
                appointment_time: "09:30"
            }),
            appointment({
                patient_name: "Asha Sharma",
                patient_phone: "919876500011",
                appointment_date: "2026-09-21",
                appointment_time: "11:00"
            }),
            appointment({
                patient_name: "Ravi Kumar",
                patient_phone: "919876500022",
                appointment_date: "2026-09-16"
            }),
            appointment({
                clinic_id: CLINIC_B,
                patient_name: "Asha Sharma",
                patient_phone: "919876500011",
                appointment_date: "2026-09-18"
            })
        ]
    });
}

Deno.test("a name finds every date, not just today", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "Asha");

    assertEquals(found?.appointments.length, 2);
});

Deno.test("results run newest first so the next visit is at the top", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "Asha");
    const dates = (found?.appointments as any[]).map((a) => a.appointment_date);

    assertEquals(dates, ["2026-09-21", "2026-09-14"]);
});

Deno.test("another clinic's patient of the same name is not returned", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "Asha");
    const clinics = new Set((found?.appointments as any[]).map((a) => a.clinic_id));

    assertEquals([...clinics], [CLINIC_A]);
});

Deno.test("a clinic searching finds only its own", async () => {
    const found = await searchAppointments(store() as any, CLINIC_B, "Asha");

    assertEquals(found?.appointments.length, 1);
    assertEquals((found?.appointments[0] as any).clinic_id, CLINIC_B);
});

Deno.test("part of a number finds the patient", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "500022");

    assertEquals(found?.appointments.length, 1);
    assertEquals((found?.appointments[0] as any).patient_name, "Ravi Kumar");
});

Deno.test("a number typed with spaces and a plus still matches", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "+91 98765 00022");

    assertEquals(found?.appointments.length, 1);
});

Deno.test("case does not matter", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "aSHA sharma");

    assertEquals(found?.appointments.length, 2);
});

Deno.test("a wildcard cannot be used to list the whole clinic", async () => {
    // Left in the pattern, % matches everything.
    const found = await searchAppointments(store() as any, CLINIC_A, "%%%");

    assertEquals(found?.tooShort, true);
    assertEquals(found?.appointments.length, 0);
});

Deno.test("a term too short to be useful is refused rather than run", async () => {
    const found = await searchAppointments(store() as any, CLINIC_A, "As");

    assertEquals(found?.tooShort, true);
});

Deno.test("what counts as a number", () => {
    assertEquals(looksLikePhone("9876500022"), true);
    assertEquals(looksLikePhone("+91 98765 00022"), true);
    assertEquals(looksLikePhone("500022"), true);
    assertEquals(looksLikePhone("Asha Sharma"), false);
    assertEquals(looksLikePhone("Asha"), false);
    // A name with a couple of digits in it is still a name.
    assertEquals(looksLikePhone("Ward 12 Asha"), false);
});

Deno.test("a long history is capped to one page", async () => {
    const many = Array.from({ length: SEARCH_LIMIT + 10 }, (_, i) =>
        appointment({
            patient_name: "Asha Sharma",
            appointment_date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`
        })
    );

    const found = await searchAppointments(fakeSupabase({ appointments: many }) as any, CLINIC_A, "Asha");

    assertEquals(found?.appointments.length, SEARCH_LIMIT);
});
