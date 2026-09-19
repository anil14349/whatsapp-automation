/**
 * The confirmation, and the calendar file that follows it.
 *
 * The old confirmation carried a Booking ID no patient is ever asked for,
 * whose embedded date was the day of booking — so it sat two lines under a
 * different date and contradicted it. It also never said which clinic, and
 * gave "Location: Clinic Visit" where the address would have been useful.
 */

import { assert, assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, tap, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { buildIcs, calendarFileName } from "../shared/appointment-calendar.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

const EVENT = {
    appointmentId: "APT_1",
    clinicName: "Wellsun Clinic & Pharmacy",
    doctorName: "Akilesh",
    date: "2026-09-18",
    time: "11:30",
    timezone: "Asia/Kolkata",
    location: "123 Medical Street, Delhi",
    token: 1
};

Deno.test("the event starts at the clinic's time, expressed in UTC", () => {
    // 11:30 in Kolkata is 06:00 UTC; a calendar reading the file in any zone
    // then shows the right local time.
    assertStringIncludes(buildIcs(EVENT), "DTSTART:20260918T060000Z");
    assertStringIncludes(buildIcs(EVENT), "DTEND:20260918T063000Z");
});

Deno.test("commas in the address do not end the field", () => {
    assertStringIncludes(buildIcs(EVENT), "LOCATION:123 Medical Street\\, Delhi");
});

Deno.test("lines are separated with CRLF, which the format requires", () => {
    const ics = buildIcs(EVENT);

    assert(ics.includes("\r\n"), "no CRLF");
    assert(!/[^\r]\n/.test(ics), "a bare newline would be rejected by some calendars");
});

Deno.test("it is a complete calendar with one event and an alarm", () => {
    const ics = buildIcs(EVENT);

    assert(ics.startsWith("BEGIN:VCALENDAR"));
    assert(ics.trimEnd().endsWith("END:VCALENDAR"));
    assertStringIncludes(ics, "SUMMARY:Appointment with Dr. Akilesh");
    assertStringIncludes(ics, "TRIGGER:-PT1H");
});

Deno.test("the id is stable, so re-sending updates the entry rather than adding one", () => {
    assertStringIncludes(buildIcs(EVENT), "UID:APT_1@");
});

Deno.test("the attachment is named for the day and the doctor, not 'appointment.ics'", () => {
    // The month is the locale's own abbreviation, which for en-GB is "Sept".
    assertEquals(calendarFileName(EVENT), "Appointment 18 Sept - Dr Akilesh.ics");
});

Deno.test("only the extension carries a dot, since a phone opens a file by its last one", () => {
    const name = calendarFileName({ ...EVENT, doctorName: "A. B. Kumar" });

    assertEquals(name.split(".").length, 2, name);
    assert(name.endsWith(".ics"), name);
});

Deno.test("a clinic with no named doctor still gets a usable name", () => {
    assertEquals(calendarFileName({ ...EVENT, doctorName: undefined }), "Appointment 18 Sept.ics");
});

function bookingAt(overrides: Record<string, unknown> = {}) {
    const data = seed();
    const supabase = fakeSupabase(data);

    Object.assign(supabase.store.clinics[0], {
        name: "Wellsun Clinic & Pharmacy",
        phone: "911112345678",
        address: "123 Medical Street",
        city: "Delhi",
        timezone: "Asia/Kolkata",
        ...overrides
    });

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const confirm = async (payload: Record<string, unknown>) => {
        supabase.store.whatsapp_sessions = [
            {
                phone: PATIENT_PHONE,
                clinic_id: CLINIC_A,
                state: "BOOK_CONFIRM",
                data: payload,
                role: "PATIENT"
            }
        ];

        await handler.handle(
            session("BOOK_CONFIRM", payload, CLINIC_A, PATIENT_PHONE, "PATIENT"),
            tap(BUTTON_IDS.CONFIRMATION.YES, PATIENT_PHONE)
        );
    };

    return { supabase, wa, confirm };
}

const BOOKING = {
    language: "EN",
    selectedDoctorId: DOCTOR_A,
    selectedDoctorName: "Akilesh",
    selectedDate: "2099-09-18",
    selectedTime: "11:30",
    patientName: "Anil",
    locationType: "CLINIC"
};

Deno.test("the confirmation names the clinic and where to go", async () => {
    const { wa, confirm } = bookingAt();

    await confirm(BOOKING);

    const said = wa.sent.map((m) => m.body).join("\n");

    assertStringIncludes(said, "Wellsun Clinic & Pharmacy");
    assertStringIncludes(said, "123 Medical Street, Delhi");
});

Deno.test("the booking id is not read out to the patient", async () => {
    const { wa, confirm } = bookingAt();

    await confirm(BOOKING);

    const said = wa.sent.map((m) => m.body).join("\n");

    assert(!said.includes("Booking ID"), said);
    assert(!/APT_\d{8}/.test(said), `an internal id reached the patient:\n${said}`);
});

Deno.test("the confirmation carries no buttons, being a receipt", async () => {
    const { wa, confirm } = bookingAt();

    await confirm(BOOKING);

    const confirmation = wa.sent.find((m) => m.body.includes("confirmed"));

    assertEquals(confirmation?.type, "text");
});

Deno.test("the receipt asks the patient for nothing", async () => {
    // It carries no buttons, and menuIdForKeyword matches the whole message
    // exactly, so any instruction would have to teach a command — on a receipt,
    // moments after booking. It says nothing instead: a later message opens
    // the menu, and the number is there for anyone who would rather ring.
    const { wa, confirm } = bookingAt();

    await confirm(BOOKING);

    const confirmation = wa.sent.find((m) => m.body.includes("confirmed"))?.body ?? "";

    assert(!/\breply\b/i.test(confirmation), `the receipt asks for a reply:\n${confirmation}`);
    assert(!/message us/i.test(confirmation), `the receipt asks for a message:\n${confirmation}`);
    assertStringIncludes(confirmation, "911112345678");
});

Deno.test("a service with no doctor is named, not called Dr. undefined", async () => {
    // Found on a real handset: a home sample collection has no doctor, and the
    // confirmation printed the missing name rather than omitting the line.
    const { wa, confirm } = bookingAt();

    await confirm({
        ...BOOKING,
        selectedDoctorId: undefined,
        selectedDoctorName: undefined,
        serviceName: "Sample Collection",
        locationType: "HOME",
        serviceAddress: "Flat 3B, above the chemist"
    });

    const said = wa.sent.map((m) => m.body).join("\n");

    assert(!/undefined/i.test(said), said);
    assertStringIncludes(said, "Sample Collection");
    assertStringIncludes(said, "At your home — Flat 3B, above the chemist");
});

