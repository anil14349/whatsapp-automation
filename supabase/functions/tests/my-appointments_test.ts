/**
 * The upcoming appointments list, and the buttons printed under it.
 *
 * Main Menu was offered and not handled, so it fell to the default branch and
 * answered with the same list again. The list also printed the row as the
 * database holds it - "13:00", "Status: CONFIRMED" - beside a greeting that
 * said "1:00 pm" about the same booking.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

const IST = "Asia/Kolkata";

function tomorrow(): string {
    const now = new Date();
    const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: IST })
        .format(now)
        .split("-")
        .map(Number);

    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function booking(extra: Record<string, unknown> = {}) {
    return {
        id: "APT_UPCOMING",
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_phone: PATIENT_PHONE,
        patient_name: "Anil",
        appointment_date: tomorrow(),
        appointment_time: "13:00",
        status: "CONFIRMED",
        // The fake ignores select(), so the embed is shaped on the row.
        doctor: { name: "A Sharma" },
        ...extra
    };
}

function build(appointments: Array<Record<string, unknown>>) {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics = [
        { id: CLINIC_A, name: "Clinic A", timezone: IST, enable_doctor_consultations: true }
    ];
    supabase.store.appointments = appointments;

    clearClinicServiceCache();
    clearClinicTimezoneCache();

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    /** What the patient tapped while the list was on screen. */
    const tap = (id: string) =>
        (handler as any).handleMyAppointments(
            PATIENT_PHONE,
            { text: id, type: "interactive" },
            session("MY_APPOINTMENTS", { language: "EN" }, CLINIC_A, PATIENT_PHONE, "PATIENT")
        );

    const sent = () => wa.sent[wa.sent.length - 1];
    const ids = () => (sent()?.buttons ?? []).map((b: any) => b.id);

    return { wa, tap, sent, ids };
}

Deno.test("Main Menu leaves the list rather than reprinting it", async () => {
    const { tap, sent } = build([booking()]);

    await tap(BUTTON_IDS.NAVIGATION.MAIN_MENU);

    assert(
        !/Upcoming Appointments/i.test(sent().body),
        `Main Menu answered with the list again:\n${sent().body}`
    );
});

Deno.test("the menu it reaches is the main one", async () => {
    const { tap, ids } = build([booking()]);

    await tap(BUTTON_IDS.NAVIGATION.MAIN_MENU);

    assert(
        ids().includes(BUTTON_IDS.PATIENT_MENU.BOOK) ||
            ids().includes(BUTTON_IDS.PATIENT_MENU.MORE),
        `not the main menu: ${JSON.stringify(ids())}`
    );
});

Deno.test("the other main menu id works too", async () => {
    const { tap, sent } = build([booking()]);

    await tap(BUTTON_IDS.PATIENT_MENU.MAIN_MENU);

    assert(!/Upcoming Appointments/i.test(sent().body), sent().body);
});

const SEEN = {
    id: "APT_PAST",
    clinic_id: CLINIC_A,
    doctor_id: DOCTOR_A,
    patient_phone: PATIENT_PHONE,
    patient_name: "Anil",
    appointment_date: "2026-09-19",
    appointment_time: "16:00",
    status: "COMPLETED",
    doctor: { name: "A Sharma" }
};

Deno.test("View History still reaches the history, not the menu", async () => {
    const { tap, sent } = build([booking(), SEEN]);

    await tap("appt_history");

    assert(/History/i.test(sent().body), `history was not shown:\n${sent().body}`);
});

Deno.test("the history reads the same way the rest of the conversation does", async () => {
    const { tap, sent } = build([booking(), SEEN]);

    await tap("appt_history");

    assert(/4:00 pm/.test(sent().body), `24 hour time in the history:\n${sent().body}`);
    assert(!/\b16:00\b/.test(sent().body), sent().body);
    assert(/Dr\. A Sharma/.test(sent().body), `the doctor lost their title:\n${sent().body}`);
});

Deno.test("anything else still shows the list, which is what the default is for", async () => {
    const { tap, sent } = build([booking()]);

    await tap("something_nobody_offered");

    assert(/Upcoming Appointments/i.test(sent().body), sent().body);
});

Deno.test("the time is shown the way the patient reads it", async () => {
    const { tap, sent } = build([booking()]);

    await tap("something_nobody_offered");

    assert(/1:00 pm/.test(sent().body), `24 hour time survived:\n${sent().body}`);
    assert(!/\b13:00\b/.test(sent().body), `raw time shown:\n${sent().body}`);
});

Deno.test("the database's own word for the status never reaches the patient", async () => {
    const { tap, sent } = build([booking()]);

    await tap("something_nobody_offered");

    assert(!/CONFIRMED/.test(sent().body), `raw status shown:\n${sent().body}`);
    assert(/Booked/.test(sent().body), `no plain word for the state:\n${sent().body}`);
});

Deno.test("a moved appointment says so", async () => {
    const { tap, sent } = build([booking({ status: "RESCHEDULED" })]);

    await tap("something_nobody_offered");

    assert(/Moved/.test(sent().body), sent().body);
    assert(!/RESCHEDULED/.test(sent().body), sent().body);
});

Deno.test("the date carries the weekday, as the greeting does", async () => {
    const { tap, sent } = build([booking()]);

    await tap("something_nobody_offered");

    const weekdays = /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/;

    assert(weekdays.test(sent().body), `no weekday in the date:\n${sent().body}`);
});

Deno.test("a patient with nothing booked is offered a way out", async () => {
    const { tap, ids, sent } = build([]);

    await tap("something_nobody_offered");

    assert(/no upcoming appointments/i.test(sent().body), sent().body);
    assertEquals(ids().includes(BUTTON_IDS.NAVIGATION.MAIN_MENU), true);
});
