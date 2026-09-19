/**
 * Picking a day, without typing one.
 *
 * The flow used to offer Today, Tomorrow and "Other date", and "Other date"
 * asked for YYYY-MM-DD. That is the hardest thing the bot ever asked anyone to
 * do: it refuses 22-09-2026, 22/09 and "next Monday", and somebody wanting the
 * day after tomorrow had to work out its date. Caught on a real handset, where
 * a patient typed two dates and was refused both.
 *
 * The rows carry the date as their id so a tap arrives looking exactly like a
 * typed date, and both go through one branch.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, tap, textMessage, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

const IST = "Asia/Kolkata";

function clinicToday(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}

function build() {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics = [
        { id: CLINIC_A, name: "Clinic A", timezone: IST, enable_doctor_consultations: true }
    ];

    supabase.store.clinic_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        day_of_week: day,
        opening_time: "09:00",
        closing_time: "18:00",
        is_active: true
    }));

    supabase.store.doctor_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        day_of_week: day,
        opening_time: "09:00",
        closing_time: "18:00",
        is_active: true
    }));

    supabase.store.appointments = [];
    supabase.store.doctor_breaks = [];

    clearClinicServiceCache();
    clearClinicTimezoneCache();

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const send = async (state: string, data: Record<string, unknown>, message: any) => {
        supabase.store.whatsapp_sessions = [
            { phone: PATIENT_PHONE, clinic_id: CLINIC_A, state, data, role: "PATIENT" }
        ];

        await handler.handle(
            session(state, data, CLINIC_A, PATIENT_PHONE, "PATIENT"),
            message
        );
    };

    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    const rows = () => wa.sent.flatMap((m) => (m.sections ?? []).flatMap((s) => s.rows));
    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, send, current, rows, said };
}

const DOCTOR_DATA = {
    language: "EN",
    selectedDoctorId: DOCTOR_A,
    selectedDoctorName: "A Sharma",
    locationType: "CLINIC"
};

Deno.test("the days are offered as a list, not as something to type", async () => {
    const { send, rows, said } = build();

    await send("BOOK_DOCTOR", DOCTOR_DATA, textMessage(DOCTOR_A));

    const offered = rows();

    assert(offered.length > 0, `no list was sent:\n${said()}`);
    assert(!/YYYY-MM-DD/.test(said()), `still asking for a typed format:\n${said()}`);
});

Deno.test("every row is a real date the patient can tap", async () => {
    const { send, rows } = build();

    await send("BOOK_DOCTOR", DOCTOR_DATA, textMessage(DOCTOR_A));

    const dates = rows().filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.id));

    assert(dates.length >= 7, `expected the bookable week, got ${dates.length}`);
    assertEquals(dates[0].id, clinicToday(), "the first row should be today");
    assert(/Today/.test(dates[0].title), dates[0].title);
    assert(/Tomorrow/.test(dates[1].title), dates[1].title);
});

Deno.test("no row is beyond the booking window", async () => {
    const { send, rows } = build();

    await send("BOOK_DOCTOR", DOCTOR_DATA, textMessage(DOCTOR_A));

    const today = clinicToday();
    const dates = rows().filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.id));

    for (const row of dates) {
        const days =
            (Date.parse(`${row.id}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;

        assert(days >= 0 && days <= 7, `${row.id} is ${days} days out, outside the window`);
    }
});

Deno.test("tapping a day is accepted exactly like typing it", async () => {
    const { send, current, rows } = build();

    await send("BOOK_DOCTOR", DOCTOR_DATA, textMessage(DOCTOR_A));

    const second = rows().filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.id))[1].id;

    await send("BOOK_DATE", DOCTOR_DATA, tap(second));

    assertEquals(current()?.state, "BOOK_TIME", "the tap did not move the booking on");
    assertEquals(current()?.data?.selectedDate, second);
});

Deno.test("a title stays inside Meta's 24 characters", async () => {
    // The client throws above the limit, which would take the whole flow down
    // rather than degrade.
    const { send, rows } = build();

    await send("BOOK_DOCTOR", DOCTOR_DATA, textMessage(DOCTOR_A));

    for (const row of rows()) {
        assert([...row.title].length <= 24, `"${row.title}" is ${row.title.length} characters`);
    }
});

Deno.test("typing a date still works for anyone who does", async () => {
    // The old path is not removed, only stopped being the only way.
    const { send, current } = build();

    const today = clinicToday();
    const [y, m, d] = today.split("-").map(Number);
    const inTwoDays = new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10);

    await send("BOOK_DATE", DOCTOR_DATA, textMessage(inTwoDays));

    assertEquals(current()?.state, "BOOK_TIME");
    assertEquals(current()?.data?.selectedDate, inTwoDays);
});

Deno.test("an unavailable doctor is named, not called 'Dr.'", async () => {
    // Reached a real handset as "Dr. is not available" — a sentence with the
    // name missing, because the name was never in the string. BOOK_DATE_CUSTOM
    // is the state it came from: a typed date inside BOOK_DATE goes straight
    // to the waitlist instead, which also prints the name and would let this
    // pass without exercising the message at all.
    const { supabase, send, said } = build();

    supabase.store.doctors[0].availability_status = "OFFLINE";

    const today = clinicToday();
    const [y, m, d] = today.split("-").map(Number);
    const soon = new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10);

    await send("BOOK_DATE_CUSTOM", DOCTOR_DATA, textMessage(soon));

    assert(/not available|busy|break/.test(said()), `not the unavailable message:\n${said()}`);
    assert(!/Dr\. is/.test(said()), `the name is still missing:\n${said()}`);
    assert(/Dr\. A Sharma/.test(said()), `the doctor was not named:\n${said()}`);
});

Deno.test("with no name to print, the title is dropped rather than left dangling", async () => {
    const { supabase, send, said } = build();

    supabase.store.doctors[0].availability_status = "OFFLINE";

    const today = clinicToday();
    const [y, m, d] = today.split("-").map(Number);
    const soon = new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10);

    await send(
        "BOOK_DATE_CUSTOM",
        { ...DOCTOR_DATA, selectedDoctorName: undefined },
        textMessage(soon)
    );

    assert(/not available|busy|break/.test(said()), `not the unavailable message:\n${said()}`);
    assert(!/Dr\./.test(said()), `printed a title with no name after it:\n${said()}`);
    assert(/That doctor/.test(said()), said());
});
