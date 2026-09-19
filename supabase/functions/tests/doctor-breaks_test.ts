/**
 * Breaks, and what moving somebody costs.
 *
 * The standing-break half is easy: lunch should not be offered. The unplanned
 * half is not, because it changes an appointment the patient already agreed
 * to. Doing that without asking is only defensible while the replacement time
 * exists and the patient has actually been told, so most of what follows is
 * about the cases where one of those is false.
 *
 * A patient moved without being reached is the worst outcome available: they
 * arrive at a slot that no longer exists, having been told nothing. Leaving
 * them where they are and making the desk ring them is strictly better, and
 * that is what these pin down.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B, DOCTOR_A } from "./helpers/fixtures.ts";
import { outsideWindowReply, restoreFetch, stubGraph } from "./helpers/fake-graph.ts";
import {
    getDoctorBreaks,
    isDuringBreak,
    isoDayOfWeek,
    takeBreak,
    toClock,
    toMinutes
} from "../shared/doctor-breaks.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

// A Monday, so day_of_week 1 is the recurring one.
const DAY = "2099-09-21";

function appointment(id: string, time: string, over: Record<string, unknown> = {}) {
    return {
        id,
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_name: `Patient ${id}`,
        patient_phone: "919000000001",
        appointment_date: DAY,
        appointment_time: time,
        token_number: 1,
        status: "CONFIRMED",
        preferred_language: "EN",
        ...over
    };
}

function build(
    appointments: Record<string, unknown>[] = [],
    breaks: Record<string, unknown>[] = [],
    closing = "18:00"
) {
    const supabase = fakeSupabase(seed());

    supabase.store.appointments = appointments;
    supabase.store.doctor_breaks = breaks;
    supabase.store.doctor_operating_hours = [
        {
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            day_of_week: isoDayOfWeek(DAY),
            opening_time: "09:00",
            closing_time: closing,
            is_active: true
        }
    ];

    return supabase;
}

Deno.test("a Monday works out to day 1, not day 0", () => {
    assertEquals(isoDayOfWeek("2099-09-21"), 1);
    // Sunday is 7 here and 0 in JavaScript, which is the whole reason for it.
    assertEquals(isoDayOfWeek("2099-09-27"), 7);
});

Deno.test("a slot inside a break is during it, and the end is not", () => {
    const lunch = [{ startTime: "13:00", endTime: "14:00" }];

    assertEquals(isDuringBreak("12:30", lunch), false);
    assertEquals(isDuringBreak("13:00", lunch), true, "the break starts here");
    assertEquals(isDuringBreak("13:30", lunch), true);
    // A break ending at two means two o'clock is free, not taken.
    assertEquals(isDuringBreak("14:00", lunch), false);
});

Deno.test("a standing break is read on its weekday and no other", async () => {
    const supabase = build([], [
        { clinic_id: CLINIC_A, doctor_id: DOCTOR_A, day_of_week: 1, start_time: "13:00", end_time: "14:00", reason: "Lunch" }
    ]);

    const monday = await getDoctorBreaks(supabase as any, CLINIC_A, DOCTOR_A, "2099-09-21");
    const tuesday = await getDoctorBreaks(supabase as any, CLINIC_A, DOCTOR_A, "2099-09-22");

    assertEquals(monday.length, 1);
    assertEquals(monday[0].startTime, "13:00");
    assertEquals(tuesday.length, 0, "a Monday lunch is not a Tuesday lunch");
});

Deno.test("an unplanned break is read on its date and no other", async () => {
    const supabase = build([], [
        { clinic_id: CLINIC_A, doctor_id: DOCTOR_A, on_date: DAY, start_time: "15:00", end_time: "15:30" }
    ]);

    assertEquals((await getDoctorBreaks(supabase as any, CLINIC_A, DOCTOR_A, DAY)).length, 1);
    assertEquals((await getDoctorBreaks(supabase as any, CLINIC_A, DOCTOR_A, "2099-09-28")).length, 0);
});

Deno.test("another doctor's lunch is not this doctor's", async () => {
    const supabase = build([], [
        { clinic_id: CLINIC_A, doctor_id: "someone-else", day_of_week: 1, start_time: "13:00", end_time: "14:00" }
    ]);

    assertEquals((await getDoctorBreaks(supabase as any, CLINIC_A, DOCTOR_A, DAY)).length, 0);
});

Deno.test("another clinic's break is not read", async () => {
    const supabase = build([], [
        { clinic_id: CLINIC_B, doctor_id: DOCTOR_A, day_of_week: 1, start_time: "13:00", end_time: "14:00" }
    ]);

    assertEquals((await getDoctorBreaks(supabase as any, CLINIC_A, DOCTOR_A, DAY)).length, 0);
});

Deno.test("taking a break moves whoever was inside it and tells them", async () => {
    const supabase = build([appointment("APT_1", "15:00")]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "15:30", "Called away");

        assertEquals(outcome.moved.length, 1);
        assertEquals(outcome.stranded.length, 0);
        assertEquals(outcome.moved[0].to, "3:30 pm");
        assertEquals(calls.length, 1, "the patient was told");
    } finally {
        restoreFetch();
    }

    assertEquals(supabase.rows("appointments")[0].appointment_time, "15:30");
});

Deno.test("a patient outside their window is left where they are", async () => {
    // The one that matters. Moving somebody Meta will not deliver to means
    // they arrive to find the slot gone and nothing explaining it.
    const supabase = build([appointment("APT_1", "15:00")]);
    const calls = stubGraph(() => outsideWindowReply());

    try {
        const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "15:30");

        assertEquals(outcome.moved.length, 0);
        assertEquals(outcome.stranded.length, 1);
        assertEquals(outcome.stranded[0].why, "unreachable");
        assertEquals(calls.length, 1, "the free-form attempt, and no template after it");
    } finally {
        restoreFetch();
    }

    assertEquals(
        supabase.rows("appointments")[0].appointment_time,
        "15:00",
        "an unreachable patient was moved anyway"
    );
});

Deno.test("with nowhere left in the day the appointment is left alone", async () => {
    // Break runs to closing, so there is no later slot to offer.
    const supabase = build([appointment("APT_1", "17:00")], [], "17:30");
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "17:00", "17:30");

        assertEquals(outcome.moved.length, 0);
        assertEquals(outcome.stranded[0].why, "no_slot");
        assertEquals(calls.length, 0, "nobody should be told about a move that cannot happen");
    } finally {
        restoreFetch();
    }

    assertEquals(supabase.rows("appointments")[0].appointment_time, "17:00");
});

Deno.test("two patients in one break do not get the same replacement", async () => {
    const supabase = build([appointment("APT_1", "15:00"), appointment("APT_2", "15:30")]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "16:00");

        assertEquals(outcome.moved.length, 2);
        assertEquals(calls.length, 2);

        const times = supabase.rows("appointments").map((a: any) => a.appointment_time).sort();

        assertEquals(times, ["16:00", "16:30"], "both were put in the same slot");
    } finally {
        restoreFetch();
    }
});

Deno.test("the replacement skips a slot somebody else already holds", async () => {
    const supabase = build([
        appointment("APT_1", "15:00"),
        appointment("APT_KEEP", "15:30", { patient_name: "Already booked" })
    ]);

    const calls = stubGraph(() => ({ ok: true }));

    try {
        await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "15:30");
    } finally {
        restoreFetch();
    }

    const moved = supabase.rows("appointments").find((a: any) => a.id === "APT_1");

    assertEquals(moved.appointment_time, "16:00", "it landed on top of an existing appointment");
});

Deno.test("the replacement is not inside lunch", async () => {
    const supabase = build(
        [appointment("APT_1", "12:30")],
        [{ clinic_id: CLINIC_A, doctor_id: DOCTOR_A, day_of_week: 1, start_time: "13:00", end_time: "14:00" }]
    );

    const calls = stubGraph(() => ({ ok: true }));

    try {
        await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "12:30", "13:00");
    } finally {
        restoreFetch();
    }

    assertEquals(
        supabase.rows("appointments")[0].appointment_time,
        "14:00",
        "somebody was moved into the doctor's lunch"
    );
});

Deno.test("a cancelled appointment inside the break is left alone", async () => {
    const supabase = build([appointment("APT_1", "15:00", { status: "CANCELLED" })]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "15:30");

        assertEquals(outcome.moved.length, 0);
        assertEquals(calls.length, 0);
    } finally {
        restoreFetch();
    }
});

Deno.test("an appointment outside the break is not touched", async () => {
    const supabase = build([appointment("APT_1", "16:00")]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "15:30");

        assertEquals(outcome.moved.length, 0);
        assertEquals(calls.length, 0);
    } finally {
        restoreFetch();
    }

    assertEquals(supabase.rows("appointments")[0].appointment_time, "16:00");
});

Deno.test("a break that ends before it starts does nothing at all", async () => {
    const supabase = build([appointment("APT_1", "15:00")]);

    const outcome = await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:30", "15:00");

    assertEquals(outcome.breakId, null);
    assertEquals(supabase.rows("doctor_breaks").length, 0, "a backwards break was recorded");
});

Deno.test("the break is recorded so nobody can book into the window being cleared", async () => {
    const supabase = build([appointment("APT_1", "15:00")]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        await takeBreak(supabase as any, CLINIC_A, DOCTOR_A, DAY, "15:00", "15:30");
    } finally {
        restoreFetch();
    }

    const recorded = supabase.rows("doctor_breaks");

    assertEquals(recorded.length, 1);
    assertEquals(recorded[0].on_date, DAY);
    assertEquals(recorded[0].start_time, "15:00");
});

Deno.test("clock arithmetic survives the edges of the day", () => {
    assertEquals(toMinutes("09:05"), 545);
    assertEquals(toClock(545), "09:05");
    assertEquals(toClock(0), "00:00");
    // A break running past midnight is the next day's problem.
    assertEquals(toClock(24 * 60 + 30), "23:59");
});
