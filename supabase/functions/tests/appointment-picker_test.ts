/**
 * Choosing which appointment to cancel or move.
 *
 * Both steps used to send "Please provide the appointment ID:" — an internal
 * `APT_20260917_bso41e` string the patient has never been shown, and which the
 * confirmation deliberately withholds. The step after it already accepted a
 * position from a numbered list; the list was simply never printed, so the
 * menu's "Cancel Appointment" was a dead end.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, tap, CLINIC_A, DOCTOR_A, PATIENT_PHONE, tomorrow } from "./helpers/fixtures.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

function appointment(id: string, time: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        clinic_id: CLINIC_A,
        patient_phone: PATIENT_PHONE,
        patient_name: "Anil",
        doctor_id: DOCTOR_A,
        service_type_id: "svc-consult",
        appointment_date: tomorrow(),
        appointment_time: time,
        status: "CONFIRMED",
        // The fake ignores select(), so the embeds PostgREST would return are
        // put on the row as it would shape them.
        doctor: { name: "A Sharma" },
        service_type: { name: "Doctor Consultation" },
        ...overrides
    };
}

function build(appointments: Record<string, unknown>[]) {
    const supabase = fakeSupabase(seed());

    supabase.store.appointments = appointments;

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const send = async (state: string, payload: Record<string, unknown>, message: any) => {
        supabase.store.whatsapp_sessions = [
            { phone: PATIENT_PHONE, clinic_id: CLINIC_A, state, data: payload, role: "PATIENT" }
        ];

        await handler.handle(
            session(state, payload, CLINIC_A, PATIENT_PHONE, "PATIENT"),
            message
        );
    };

    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, send, current, said };
}

Deno.test("cancelling never asks the patient for an internal id", async () => {
    const { send, said } = build([appointment("APT_ONE", "10:00")]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.CANCEL));

    assert(!/appointment ID/i.test(said()), said());
    assert(!/APT_/.test(said()), `an internal id reached the patient:\n${said()}`);
});

Deno.test("one appointment goes straight to confirming it, described in words", async () => {
    // Only one may be active at a time, so picking from a list of one is a
    // step for nothing.
    const { send, current, said } = build([appointment("APT_ONE", "10:00")]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.CANCEL));

    assertEquals(current()?.state, "CANCEL_CONFIRM");
    assertEquals(current()?.data?.selectedAppointmentId, "APT_ONE");
    assert(/Dr\. A Sharma/.test(said()), said());
    assert(/10:00 am/.test(said()), said());
});

Deno.test("the confirmation carries buttons, not a typed yes", async () => {
    const { send, wa } = build([appointment("APT_ONE", "10:00")]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.CANCEL));

    const asked = wa.sent.find((m) => /Cancel this appointment/i.test(m.body));

    assertEquals(asked?.type, "buttons");
    assertEquals(asked?.buttons?.map((b) => b.id), [
        BUTTON_IDS.CONFIRMATION.YES,
        BUTTON_IDS.CONFIRMATION.NO
    ]);
});

Deno.test("several appointments are listed to choose from", async () => {
    const { send, wa, current } = build([
        appointment("APT_ONE", "10:00"),
        appointment("APT_TWO", "11:30", { patient_name: "Meera" })
    ]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.CANCEL));

    const list = wa.sent.find((m) => m.type === "list");

    assertEquals(list?.sections?.[0].rows.length, 2);
    assertEquals(current()?.state, "CANCEL_SELECT");
});

Deno.test("picking from the list resolves to the right appointment", async () => {
    const { send, current } = build([
        appointment("APT_ONE", "10:00"),
        appointment("APT_TWO", "11:30")
    ]);

    await send("CANCEL_SELECT", { language: "EN" }, tap("2"));

    assertEquals(current()?.state, "CANCEL_CONFIRM");
    assertEquals(current()?.data?.selectedAppointmentId, "APT_TWO");
});

Deno.test("picking from the list does not read the id back either", async () => {
    // The single-appointment path was fixed first; this one still echoed
    // "Are you sure you want to cancel appointment APT_20260917_bso41e?".
    const { send, wa, said } = build([
        appointment("APT_ONE", "10:00"),
        appointment("APT_TWO", "11:30")
    ]);

    await send("CANCEL_SELECT", { language: "EN" }, tap("2"));

    assert(!/APT_/.test(said()), `an internal id reached the patient:\n${said()}`);

    const asked = wa.sent.find((m) => /Cancel this appointment/i.test(m.body));
    assertEquals(asked?.type, "buttons");
});

Deno.test("picking from the list to reschedule offers dates", async () => {
    const { send, current, said } = build([
        appointment("APT_ONE", "10:00"),
        appointment("APT_TWO", "11:30")
    ]);

    await send("RESCHEDULE_SELECT", { language: "EN" }, tap("1"));

    assertEquals(current()?.state, "RESCHEDULE_DATE");
    assertEquals(current()?.data?.selectedAppointmentId, "APT_ONE");
    assert(!/YYYY-MM-DD/.test(said()), said());
});

Deno.test("an id belonging to someone else is not accepted", async () => {
    // The choice is resolved against this patient's own list, so a guessed id
    // never becomes a selection.
    const { send, current } = build([
        appointment("APT_MINE", "10:00"),
        appointment("APT_THEIRS", "09:00", { patient_phone: "919999999999" })
    ]);

    await send("CANCEL_SELECT", { language: "EN" }, tap("APT_THEIRS"));

    assert(current()?.data?.selectedAppointmentId !== "APT_THEIRS", "another patient's appointment was selected");
});

Deno.test("no appointments returns to the menu and says so", async () => {
    const { send, current, said } = build([]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.CANCEL));

    assertEquals(current()?.state, "MAIN_MENU");
    assert(/no upcoming appointments/i.test(said()), said());
});

Deno.test("rescheduling offers dates instead of demanding YYYY-MM-DD", async () => {
    const { send, current, said } = build([appointment("APT_ONE", "10:00")]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.RESCHEDULE));

    assertEquals(current()?.state, "RESCHEDULE_DATE");
    assert(!/YYYY-MM-DD/.test(said()), said());
});

Deno.test("a tapped date is understood when rescheduling", async () => {
    // The date buttons send an id, and this step only ever parsed YYYY-MM-DD.
    const { send, said } = build([appointment("APT_ONE", "10:00")]);

    await send(
        "RESCHEDULE_DATE",
        { language: "EN", selectedAppointmentId: "APT_ONE" },
        tap(BUTTON_IDS.DATE_SELECT.TOMORROW)
    );

    assert(!/Invalid date format/i.test(said()), said());
});
