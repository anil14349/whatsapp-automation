/**
 * The clinic's own figures.
 *
 * The risk in a summary is not that it fails, it is that it is confidently
 * wrong: a number nobody can check reads exactly the same whether or not it is
 * right. So these cover what gets counted, what deliberately does not, and the
 * two cases that would otherwise round into a comfortable lie — a period too
 * large to count, and a rate over nobody.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { CLINIC_A, CLINIC_B, DOCTOR_A } from "./helpers/fixtures.ts";
import { buildSummary, MAX_ROWS } from "../shared/summary.ts";

function appointment(over: Record<string, unknown> = {}) {
    return {
        id: crypto.randomUUID(),
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        appointment_date: "2026-09-10",
        appointment_time: "10:00",
        status: "COMPLETED",
        booking_source: "WHATSAPP",
        location_type: "CLINIC",
        is_revisit: false,
        ...over
    };
}

function store(appointments: Record<string, unknown>[], extra: Record<string, unknown[]> = {}) {
    return fakeSupabase({
        appointments,
        feedback: [],
        patient_documents: [],
        appointment_reminders: [],
        ...extra
    });
}

const FROM = "2026-09-01";
const TO = "2026-09-30";

Deno.test("each outcome is counted once", async () => {
    const summary = await buildSummary(
        store([
            appointment({ status: "COMPLETED" }),
            appointment({ status: "COMPLETED" }),
            appointment({ status: "NO_SHOW" }),
            appointment({ status: "CONFIRMED" }),
            appointment({ status: "CANCELLED" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.completed, 2);
    assertEquals(summary?.noShow, 1);
    assertEquals(summary?.stillToBeSeen, 1);
    assertEquals(summary?.cancelled, 1);
});

Deno.test("a cancelled appointment is not business the clinic did", async () => {
    const summary = await buildSummary(
        store([
            appointment({ status: "COMPLETED" }),
            appointment({ status: "CANCELLED", booking_source: "WALK_IN" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.booked, 1, "booked should exclude the cancellation");
    assertEquals(summary?.bySource.WALK_IN, undefined, "a cancellation is not a walk-in booking");
});

Deno.test("the no-show rate is over those who were due, not everyone", async () => {
    const summary = await buildSummary(
        store([
            appointment({ status: "COMPLETED" }),
            appointment({ status: "COMPLETED" }),
            appointment({ status: "COMPLETED" }),
            appointment({ status: "NO_SHOW" }),
            // Still to come, so not yet a no-show either way.
            appointment({ status: "CONFIRMED" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.noShowRate, 25);
});

Deno.test("a rate over nobody is unknown, not zero", async () => {
    const summary = await buildSummary(
        store([appointment({ status: "CONFIRMED" })]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(
        summary?.noShowRate,
        null,
        "reporting 0% when nobody has been seen would be a comfortable lie"
    );
});

Deno.test("another clinic's day is not counted in this one", async () => {
    const summary = await buildSummary(
        store([
            appointment(),
            appointment({ clinic_id: CLINIC_B }),
            appointment({ clinic_id: CLINIC_B })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.booked, 1);
});

Deno.test("appointments outside the period are left out", async () => {
    const summary = await buildSummary(
        store([
            appointment({ appointment_date: "2026-08-31" }),
            appointment({ appointment_date: "2026-09-15" }),
            appointment({ appointment_date: "2026-10-01" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.booked, 1);
});

Deno.test("the day is split by where it came from and where it happened", async () => {
    const summary = await buildSummary(
        store([
            appointment({ booking_source: "WHATSAPP", location_type: "CLINIC" }),
            appointment({ booking_source: "WHATSAPP", location_type: "HOME" }),
            appointment({ booking_source: "WALK_IN", location_type: "CLINIC" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.bySource, { WHATSAPP: 2, WALK_IN: 1 });
    assertEquals(summary?.byLocation, { CLINIC: 2, HOME: 1 });
});

Deno.test("a location saved in the old lower case still counts as one place", async () => {
    // Two spellings were in use before they were unified; a summary that
    // treats them as different places invents a split that is not real.
    const summary = await buildSummary(
        store([
            appointment({ location_type: "CLINIC" }),
            appointment({ location_type: "clinic" }),
            appointment({ location_type: "home" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.byLocation, { CLINIC: 2, HOME: 1 });
});

Deno.test("the busiest hours are grouped by hour, in order", async () => {
    const summary = await buildSummary(
        store([
            appointment({ appointment_time: "09:00" }),
            appointment({ appointment_time: "09:30" }),
            appointment({ appointment_time: "14:00" })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.busiestHours, [
        { hour: "09:00", count: 2 },
        { hour: "14:00", count: 1 }
    ]);
});

Deno.test("a period too big to count says so rather than under-reporting", async () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, () => appointment());

    const summary = await buildSummary(store(many) as any, CLINIC_A, FROM, TO);

    assertEquals(summary?.truncated, true, "a partial total must not read as a whole one");
    assertEquals(summary?.completed, MAX_ROWS);
});

Deno.test("a period that fits is not flagged as truncated", async () => {
    const summary = await buildSummary(store([appointment()]) as any, CLINIC_A, FROM, TO);

    assertEquals(summary?.truncated, false);
});

Deno.test("returning patients are counted", async () => {
    const summary = await buildSummary(
        store([
            appointment({ is_revisit: true }),
            appointment({ is_revisit: true }),
            appointment({ is_revisit: false })
        ]) as any,
        CLINIC_A,
        FROM,
        TO
    );

    assertEquals(summary?.revisits, 2);
});
