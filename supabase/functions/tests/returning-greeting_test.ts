/**
 * What a returning patient is greeted with.
 *
 * The greeting was always the same menu, led by "Book Appointment". Only one
 * appointment may be active at a time, so for a patient who already has one
 * that button is the single thing the bot will refuse, while the two actions
 * they might actually want are hidden behind "More Options".
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

    const greet = () =>
        handler.greetReturningPatient(
            session("MAIN_MENU", { language: "EN" }, CLINIC_A, PATIENT_PHONE, "PATIENT"),
            "Clinic A"
        );

    const sent = () => wa.sent[wa.sent.length - 1];
    const titles = () => (sent()?.buttons ?? []).map((b: any) => b.title);
    const ids = () => (sent()?.buttons ?? []).map((b: any) => b.id);

    return { supabase, wa, greet, sent, titles, ids };
}

const BOOKED = {
    id: "APT_ALREADY",
    clinic_id: CLINIC_A,
    doctor_id: DOCTOR_A,
    patient_phone: PATIENT_PHONE,
    patient_name: "Anil",
    appointment_date: tomorrow(),
    appointment_time: "16:00",
    status: "CONFIRMED",
    // The fake ignores select(), so the embed is shaped on the row.
    doctor: { name: "A Sharma" }
};

Deno.test("a patient with a booking is greeted with it, not with Book", async () => {
    const { greet, sent, ids } = build([BOOKED]);

    await greet();

    assert(/already have an appointment/i.test(sent().body), sent().body);
    assert(/A Sharma/.test(sent().body), `the booking is not named:\n${sent().body}`);
    assert(
        !ids().includes(BUTTON_IDS.PATIENT_MENU.BOOK),
        "offered Book, which is the one thing that would be refused"
    );
});

Deno.test("the two things they can do are the buttons", async () => {
    const { greet, ids } = build([BOOKED]);

    await greet();

    assert(ids().includes(BUTTON_IDS.PATIENT_MENU.RESCHEDULE), "no way to move it");
    assert(ids().includes(BUTTON_IDS.PATIENT_MENU.CANCEL), "no way to cancel it");
});

Deno.test("the time is shown the way the patient reads it", async () => {
    const { greet, sent } = build([BOOKED]);

    await greet();

    assert(/4:00 pm/i.test(sent().body), `raw time in the greeting:\n${sent().body}`);
    assert(!sent().body.includes("16:00"), `raw 24-hour time reached the patient:\n${sent().body}`);
});

Deno.test("a patient with nothing booked still gets the usual menu", async () => {
    // The control: without it the assertions above would be satisfied by a
    // greeting that never mentioned booking at all.
    const { greet, sent, ids } = build([]);

    await greet();

    assert(ids().includes(BUTTON_IDS.PATIENT_MENU.BOOK), "the booking route disappeared");
    assert(!/already have an appointment/i.test(sent().body), sent().body);
});

Deno.test("a finished visit does not count as one they have", async () => {
    const { greet, ids } = build([{ ...BOOKED, status: "COMPLETED" }]);

    await greet();

    assert(
        ids().includes(BUTTON_IDS.PATIENT_MENU.BOOK),
        "a completed visit blocked the booking route"
    );
});

Deno.test("another clinic's booking is not theirs here", async () => {
    const { greet, ids } = build([{ ...BOOKED, clinic_id: "other-clinic" }]);

    await greet();

    assert(ids().includes(BUTTON_IDS.PATIENT_MENU.BOOK));
});
