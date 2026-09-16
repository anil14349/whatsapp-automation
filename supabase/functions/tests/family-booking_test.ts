/**
 * Booking for someone else in the household.
 *
 * One number books for a mother, then her child, then her father. The name is
 * already asked fresh each time and stored on the appointment, so the bookings
 * were always distinct — but the whole name had to be typed again every time,
 * on a phone, often in a second language. The names a number has used are the
 * household, so they are offered back.
 *
 * The reply carries a position, never a name. Sending the household's names
 * out and accepting them back would let a crafted reply book under anything at
 * all, so the list lives in the session and the reply only indexes into it.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, textMessage, tap, CLINIC_A, CLINIC_B, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { BUTTON_IDS, patientNameButtonId } from "../shared/button-ids.ts";
import { knownPatientNames, MAX_REMEMBERED_NAMES } from "../shared/patient-names.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

function past(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

function appointment(over: Record<string, unknown>) {
    return {
        id: crypto.randomUUID(),
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_phone: PATIENT_PHONE,
        patient_name: "Asha Rao",
        appointment_date: past(10),
        appointment_time: "10:00",
        status: "COMPLETED",
        ...over
    };
}

function build(appointments: Record<string, unknown>[] = []) {
    const data = seed();
    data.appointments = appointments as any;

    const supabase = fakeSupabase(data);
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

    return { supabase, wa, send, current };
}

Deno.test("names used before are the household, most recent first", async () => {
    const supabase = fakeSupabase({
        appointments: [
            appointment({ patient_name: "Asha Rao", appointment_date: past(30) }),
            appointment({ patient_name: "Ravi Rao", appointment_date: past(5) }),
            appointment({ patient_name: "Meena Rao", appointment_date: past(60) })
        ]
    });

    const names = await knownPatientNames(supabase as any, CLINIC_A, PATIENT_PHONE);

    assertEquals(names, ["Ravi Rao", "Asha Rao", "Meena Rao"]);
});

Deno.test("the same person spelt differently is offered once", async () => {
    const supabase = fakeSupabase({
        appointments: [
            appointment({ patient_name: "Asha Rao", appointment_date: past(2) }),
            appointment({ patient_name: "asha rao", appointment_date: past(9) })
        ]
    });

    const names = await knownPatientNames(supabase as any, CLINIC_A, PATIENT_PHONE);

    assertEquals(names, ["Asha Rao"], "the spelling they last used is the one offered");
});

Deno.test("another clinic's history is not this clinic's household", async () => {
    const supabase = fakeSupabase({
        appointments: [
            appointment({ patient_name: "Asha Rao" }),
            appointment({ clinic_id: CLINIC_B, patient_name: "Someone Else" })
        ]
    });

    const names = await knownPatientNames(supabase as any, CLINIC_A, PATIENT_PHONE);

    assertEquals(names, ["Asha Rao"]);
});

Deno.test("a name unused for over a year is not offered", async () => {
    const supabase = fakeSupabase({
        appointments: [appointment({ patient_name: "Long Ago", appointment_date: past(400) })]
    });

    assertEquals(await knownPatientNames(supabase as any, CLINIC_A, PATIENT_PHONE), []);
});

Deno.test("the list stays inside WhatsApp's ten rows", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
        appointment({ patient_name: `Person ${i}`, appointment_date: past(i + 1) })
    );

    const names = await knownPatientNames(fakeSupabase({ appointments: many }) as any, CLINIC_A, PATIENT_PHONE);

    assertEquals(names.length, MAX_REMEMBERED_NAMES);
    assert(names.length + 1 <= 10, "one row is reserved for Someone else");
});

Deno.test("the appointment list says who each booking is for", async () => {
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    const { wa, send } = build([
        appointment({
            patient_name: "Ravi Rao",
            appointment_date: future,
            appointment_time: "10:00",
            status: "CONFIRMED"
        }),
        appointment({
            patient_name: "Asha Rao",
            appointment_date: future,
            appointment_time: "11:00",
            status: "CONFIRMED"
        })
    ]);

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.APPOINTMENTS));

    const said = wa.sent.map((m) => m.body).join("\n");

    // One number holds the whole household's bookings, so a list that does not
    // name them is unreadable.
    assert(/Ravi Rao/.test(said), `the list did not name the patient: ${said}`);
    assert(/Asha Rao/.test(said), said);
});

Deno.test("picking a name from the household books under it", async () => {
    const { wa, send, current } = build([
        appointment({ patient_name: "Ravi Rao", appointment_date: past(3) })
    ]);

    await send(
        "BOOK_NAME",
        { language: "EN", offeredNames: ["Ravi Rao", "Asha Rao"], selectedTime: "10:00" },
        tap(patientNameButtonId(0))
    );

    assertEquals(current()?.state, "BOOK_CONFIRM");
    assertEquals(current()?.data?.patientName, "Ravi Rao");

    // The confirmation must say who it is for, or picking from a list is blind.
    const said = wa.sent.map((m) => m.body).join("\n");

    assert(/Ravi Rao/.test(said), `the confirmation did not name the patient: ${said}`);
});

Deno.test("a position that was never offered is refused", async () => {
    const { wa, send, current } = build([]);

    await send(
        "BOOK_NAME",
        { language: "EN", offeredNames: ["Ravi Rao"] },
        tap(patientNameButtonId(7))
    );

    assertEquals(current()?.state, "BOOK_NAME", "a crafted position must not book anything");
    assert(/choose from the list/i.test(wa.sent.map((m) => m.body).join("\n")));
});

Deno.test("someone else asks for a name and still accepts it", async () => {
    const { wa, send, current } = build([]);

    await send(
        "BOOK_NAME",
        { language: "EN", offeredNames: ["Ravi Rao"] },
        tap(BUTTON_IDS.PATIENT_NAME.SOMEONE_ELSE)
    );

    assertEquals(current()?.state, "BOOK_NAME");
    assert(/type the patient's full name/i.test(wa.sent.map((m) => m.body).join("\n")));

    await send(
        "BOOK_NAME",
        { language: "EN", offeredNames: ["Ravi Rao"], selectedTime: "10:00" },
        textMessage("Baby Rao")
    );

    assertEquals(current()?.state, "BOOK_CONFIRM");
    assertEquals(current()?.data?.patientName, "Baby Rao");
});

Deno.test("typing a name still works when a household is offered", async () => {
    const { send, current } = build([]);

    await send(
        "BOOK_NAME",
        { language: "EN", offeredNames: ["Ravi Rao"], selectedTime: "10:00" },
        textMessage("Meena Rao")
    );

    assertEquals(current()?.data?.patientName, "Meena Rao");
});
