/**
 * The doctor's own way of stepping out.
 *
 * What matters here is the reply. The doctor is the only person who can chase
 * somebody the system could not move, so "2 patients affected" is useless to
 * them — they need the names and the reason.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, textMessage, tap, today, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { outsideWindowReply, restoreFetch, stubGraph } from "./helpers/fake-graph.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { isoDayOfWeek } from "../shared/doctor-breaks.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

const { DoctorFlowHandler } = await import("../shared/handlers/doctor-handler.ts");

let counter = 0;

function build(appointments: Record<string, unknown>[] = []) {
    counter += 1;
    const phone = `9197300${String(counter).padStart(5, "0")}`;

    const supabase = fakeSupabase(seed());

    supabase.store.doctors[0].phone = phone;
    supabase.store.appointments = appointments;
    supabase.store.doctor_breaks = [];
    supabase.store.doctor_operating_hours = [
        {
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            day_of_week: isoDayOfWeek(today()),
            opening_time: "09:00",
            closing_time: "18:00",
            is_active: true
        }
    ];

    const wa = new FakeWhatsAppClient();
    const handler = new DoctorFlowHandler(supabase, wa);

    const send = async (state: string, message: any) => {
        const data = {
            authenticated: true,
            doctorId: DOCTOR_A,
            doctorName: "Dr A Sharma",
            clinicId: CLINIC_A
        };

        supabase.store.whatsapp_sessions = [
            { phone, clinic_id: CLINIC_A, state, data, role: "DOCTOR" }
        ];

        await handler.handle(session(state, data, CLINIC_A, phone, "DOCTOR"), message);
    };

    const said = () => wa.sent.map((m) => m.body).join("\n");
    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === phone);

    return { supabase, wa, phone, send, said, current };
}

function appointment(id: string, time: string, name: string, over: Record<string, unknown> = {}) {
    return {
        id,
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        patient_name: name,
        patient_phone: "919000000001",
        appointment_date: today(),
        appointment_time: time,
        token_number: 3,
        status: "CONFIRMED",
        preferred_language: "EN",
        ...over
    };
}

Deno.test("the break option asks for a window", async () => {
    const { send, phone, said, current } = build();

    await send("DOCTOR_MENU", tap(BUTTON_IDS.DOCTOR_MENU.BREAK, phone));

    assertEquals(current()?.state, "DOCTOR_BREAK");
    assert(/15:00-15:45|HH:MM/.test(said()), `no example was given:\n${said()}`);
});

Deno.test("a window that is not two times is refused", async () => {
    const { send, phone, said, supabase } = build();

    await send("DOCTOR_BREAK", textMessage("back in a bit", phone));

    assertEquals(supabase.rows("doctor_breaks").length, 0, "a break was recorded from free text");
    assert(/HH:MM/.test(said()));
});

Deno.test("a backwards window is refused before anything is recorded", async () => {
    const { send, phone, supabase, said } = build();

    await send("DOCTOR_BREAK", textMessage("15:45-15:00", phone));

    assertEquals(supabase.rows("doctor_breaks").length, 0);
    assert(/after the start/i.test(said()), said());
});

Deno.test("a break with nobody booked says so", async () => {
    const { send, phone, supabase, said } = build();

    await send("DOCTOR_BREAK", textMessage("15:00-15:45", phone));

    assertEquals(supabase.rows("doctor_breaks").length, 1);
    assert(/Nobody was booked/i.test(said()), said());
});

Deno.test("whoever was moved is named, with where they went", async () => {
    const { send, phone, said, supabase } = build([appointment("APT_1", "15:00", "Anil")]);
    const calls = stubGraph(() => ({ ok: true }));

    try {
        await send("DOCTOR_BREAK", textMessage("15:00-15:45", phone));
    } finally {
        restoreFetch();
    }

    assert(/Anil/.test(said()), `the doctor was not told who moved:\n${said()}`);
    assert(/3:00 pm/.test(said()) && /4:00 pm/.test(said()), said());
    assertEquals(supabase.rows("appointments")[0].appointment_time, "16:00");
});

Deno.test("whoever could not be reached is named as needing a call", async () => {
    // The reply the doctor actually has to act on.
    const { send, phone, said, supabase } = build([appointment("APT_1", "15:00", "Anil")]);
    const calls = stubGraph(() => outsideWindowReply());

    try {
        await send("DOCTOR_BREAK", textMessage("15:00-15:45", phone));
    } finally {
        restoreFetch();
    }

    assert(/call them/i.test(said()), `no instruction to chase them:\n${said()}`);
    assert(/Anil/.test(said()));
    assert(/could not be messaged/i.test(said()), said());
    assertEquals(
        supabase.rows("appointments")[0].appointment_time,
        "15:00",
        "an unreachable patient was moved anyway"
    );
});

Deno.test("the doctor is put back at the menu afterwards", async () => {
    const { send, phone, current } = build();

    await send("DOCTOR_BREAK", textMessage("15:00-15:45", phone));

    assertEquals(current()?.state, "DOCTOR_MENU");
});
