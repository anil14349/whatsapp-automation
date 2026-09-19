/**
 * The waiting room board, and the message that comes off it.
 *
 * The risky part is not who gets told — it is who gets told by mistake. The
 * notice fires on a completion, but it is sent twenty seconds later, and in
 * those twenty seconds the completion can be undone at the desk. If the notice
 * still went out, a patient would be called in over somebody who had never
 * left the room, and would stop believing the next one.
 *
 * There is no undo path in the code to test, because the queue is read again
 * when the timer expires rather than remembered. These pin that down: the
 * re-read has to be the thing that protects the patient behind.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B, DOCTOR_A, DOCTOR_B } from "./helpers/fixtures.ts";
import { outsideWindowReply, restoreFetch, stubGraph } from "./helpers/fake-graph.ts";
import { notifyNextUp, readConsultationQueue } from "../shared/consultation-queue.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const DAY = "2099-09-21";

function appointment(token: number, over: Record<string, unknown> = {}) {
    return {
        id: `APT_${token}`,
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_name: `Patient ${token}`,
        patient_phone: `91900000000${token}`,
        appointment_date: DAY,
        appointment_time: `1${token}:00`,
        token_number: token,
        status: "CONFIRMED",
        preferred_language: "EN",
        next_up_notified_at: null,
        ...over
    };
}

function build(appointments: Record<string, unknown>[]) {
    const supabase = fakeSupabase(seed());
    supabase.store.appointments = appointments;
    return supabase;
}

Deno.test("the board names who is in the room and who is next", async () => {
    const supabase = build([appointment(1), appointment(2), appointment(3), appointment(4)]);

    const board = await readConsultationQueue(supabase as any, CLINIC_A, DAY);

    assertEquals(board.doctors.length, 1);

    const queue = board.doctors[0];

    assertEquals(queue.nowSeeing?.token, 1);
    assertEquals(queue.next?.token, 2);
    assertEquals(queue.waiting, 2, "the two behind the pair already named");
    assertEquals(queue.started, false, "nobody has been marked either way yet");
});

Deno.test("a completion moves the queue up without anyone recording it", async () => {
    const supabase = build([
        appointment(1, { status: "COMPLETED" }),
        appointment(2),
        appointment(3)
    ]);

    const board = await readConsultationQueue(supabase as any, CLINIC_A, DAY);
    const queue = board.doctors[0];

    assertEquals(queue.nowSeeing?.token, 2);
    assertEquals(queue.next?.token, 3);
    assertEquals(queue.seen, 1);
    assertEquals(queue.started, true);
});

Deno.test("a no-show moves the queue up the same as a completion", async () => {
    const supabase = build([appointment(1, { status: "NO_SHOW" }), appointment(2)]);

    const board = await readConsultationQueue(supabase as any, CLINIC_A, DAY);

    assertEquals(board.doctors[0].nowSeeing?.token, 2);
});

Deno.test("the patient now at the front is told it is their turn", async () => {
    const supabase = build([appointment(1, { status: "COMPLETED" }), appointment(2)]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);

        assertEquals(result.delivered, true);
        assertEquals(result.appointmentId, "APT_2");
        assertEquals(calls.length, 1);
        assertEquals(calls[0].body.to, "919000000002");
    } finally {
        restoreFetch();
    }

    const row = supabase.rows("appointments").find((r: any) => r.id === "APT_2");

    assertEquals(row.next_up_notified_at !== null, true, "the board must show them as told");
});

Deno.test("undoing the completion leaves the patient behind alone", async () => {
    // Token 1 was marked complete and then reopened at the desk within the
    // changeover. By the time the timer fires the queue has gone back, and
    // token 1 was told it was their turn when token 0 finished.
    const supabase = build([
        appointment(1, { next_up_notified_at: "2099-09-21T10:00:00" }),
        appointment(2)
    ]);

    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);

        assertEquals(result.reason, "already_told");
        assertEquals(result.delivered, false);
        assertEquals(calls.length, 0, "token 2 must not be called in over token 1");
    } finally {
        restoreFetch();
    }
});

Deno.test("nobody is told twice", async () => {
    const supabase = build([appointment(1, { status: "COMPLETED" }), appointment(2)]);

    const first = stubGraph(() => ({ ok: true }));

    try {
        await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);
        assertEquals(first.length, 1);

        // A second completion arriving late, or the same one retried.
        await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);
        assertEquals(first.length, 1, "the second pass must send nothing");
    } finally {
        restoreFetch();
    }
});

Deno.test("a patient Meta will not accept is left untold rather than half told", async () => {
    const supabase = build([appointment(1, { status: "COMPLETED" }), appointment(2)]);
    const calls = stubGraph(() => outsideWindowReply());

    try {
        const result = await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);

        assertEquals(result.delivered, false);
        assertEquals(result.reason, "unreachable");
        assertEquals(calls.length, 1, "the free-form attempt, and no template after it");
    } finally {
        restoreFetch();
    }

    const row = supabase.rows("appointments").find((r: any) => r.id === "APT_2");

    assertEquals(
        row.next_up_notified_at,
        null,
        "an unreachable patient must read as untold so the desk calls their name"
    );
});

Deno.test("an empty queue sends nothing", async () => {
    const supabase = build([appointment(1, { status: "COMPLETED" })]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        const result = await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);

        assertEquals(result.reason, "nobody_waiting");
        assertEquals(calls.length, 0);
    } finally {
        restoreFetch();
    }
});

Deno.test("a service with no doctor has no place on the board", async () => {
    const supabase = build([
        appointment(1, { doctor_id: null, token_number: null }),
        appointment(2)
    ]);

    const board = await readConsultationQueue(supabase as any, CLINIC_A, DAY);

    assertEquals(board.doctors.length, 1);
    assertEquals(board.doctors[0].nowSeeing?.token, 2);
});

Deno.test("a cancelled appointment is not standing in the queue", async () => {
    const supabase = build([appointment(1, { status: "CANCELLED" }), appointment(2)]);

    const board = await readConsultationQueue(supabase as any, CLINIC_A, DAY);
    const queue = board.doctors[0];

    assertEquals(queue.nowSeeing?.token, 2);
    assertEquals(queue.seen, 0, "a cancellation is not somebody who was seen");
});

Deno.test("another clinic's queue is not read", async () => {
    const supabase = build([
        appointment(1, { clinic_id: CLINIC_B, doctor_id: DOCTOR_B }),
        appointment(2)
    ]);

    const board = await readConsultationQueue(supabase as any, CLINIC_A, DAY);

    assertEquals(board.doctors.length, 1);
    assertEquals(board.doctors[0].doctorId, DOCTOR_A);
    assertEquals(board.doctors[0].nowSeeing?.token, 2);
});

Deno.test("one doctor's queue does not move when another's does", async () => {
    const supabase = fakeSupabase(seed());

    supabase.store.doctors.push({
        id: "doc-a2",
        clinic_id: CLINIC_A,
        name: "Dr Z Iyer",
        is_active: true,
        availability_status: "AVAILABLE"
    });

    supabase.store.appointments = [
        appointment(1, { status: "COMPLETED" }),
        appointment(2),
        appointment(3, { id: "APT_OTHER", doctor_id: "doc-a2", token_number: 1 })
    ];

    const calls = stubGraph(() => ({ ok: true }));

    try {
        await notifyNextUp(supabase as any, CLINIC_A, DOCTOR_A, DAY);

        assertEquals(calls.length, 1);
        assertEquals(calls[0].body.to, "919000000002", "the other doctor's patient is untouched");
    } finally {
        restoreFetch();
    }
});
