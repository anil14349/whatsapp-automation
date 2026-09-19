/**
 * Which doctors a patient is offered on WhatsApp.
 *
 * A live incident started this: a doctor existed who was active but OFFLINE,
 * so the list offered them, every date came back with no slots, and a real
 * patient dead-ended twice before giving up. getAvailableSlots returns nothing
 * for the whole day unless the status is AVAILABLE or IN_CONSULTATION, so
 * BUSY and ON_BREAK fail exactly the same way.
 *
 * Separately, a clinic may have a doctor who only ever takes walk-ins.
 * takes_online_appointments=false keeps them off WhatsApp while leaving them
 * bookable at the front desk.
 *
 * Every test here keeps a second, bookable doctor in the clinic. Without that
 * control an empty list would satisfy "the excluded doctor is absent" and the
 * test would pass even if the filter threw everyone away.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

// getDoctors orders by name, so "A Sharma" is always row 1 when listed. The
// control sorts after it: if the filter fails to drop row 1, a tap on "1"
// lands on the wrong doctor and the position assertions below catch it.
const CONTROL_ID = "doctor-control";
const CONTROL_NAME = "Z Control";

function build() {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics = [
        {
            id: CLINIC_A,
            name: "Clinic A",
            timezone: "Asia/Kolkata",
            enable_doctor_consultations: true
        }
    ];

    supabase.store.doctors.push({
        id: CONTROL_ID,
        clinic_id: CLINIC_A,
        name: CONTROL_NAME,
        phone: "919000009999",
        email: "control@example.com",
        specialization: "General Physician",
        is_active: true,
        availability_status: "AVAILABLE",
        takes_online_appointments: true,
        pin_hash: null
    });

    clearClinicServiceCache();
    clearClinicTimezoneCache();

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const send = async (state: string, data: Record<string, unknown>, message: any) => {
        supabase.store.whatsapp_sessions = [
            { phone: PATIENT_PHONE, clinic_id: CLINIC_A, state, data, role: "PATIENT" }
        ];

        await handler.handle(session(state, data, CLINIC_A, PATIENT_PHONE, "PATIENT"), message);
    };

    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    const rows = () => wa.sent.flatMap((m) => (m.sections ?? []).flatMap((s) => s.rows));
    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, send, current, rows, said };
}

const LANG = { language: "EN" };

// An id that matches nobody makes BOOK_DOCTOR re-show the list, which is the
// same render path a patient reaches from the menu but reachable in one step.
const SHOW_LIST = { type: "text", text: "no-such-doctor" };

function listed(rows: Array<{ id: string; title: string }>) {
    return rows.filter((r) => r.id.startsWith("doctor_")).map((r) => r.title);
}

Deno.test("a walk-ins-only doctor is not offered on WhatsApp", async () => {
    const { supabase, send, rows } = build();

    supabase.store.doctors[0].takes_online_appointments = false;

    await send("BOOK_DOCTOR", LANG, SHOW_LIST);

    const names = listed(rows());

    assert(names.some((n) => n.includes(CONTROL_NAME)), `the control is missing too:\n${names}`);
    assert(!names.some((n) => n.includes("A Sharma")), `walk-ins-only doctor offered:\n${names}`);
});

for (const status of ["OFFLINE", "BUSY", "ON_BREAK"]) {
    Deno.test(`a ${status} doctor is not offered on WhatsApp`, async () => {
        const { supabase, send, rows } = build();

        supabase.store.doctors[0].availability_status = status;

        await send("BOOK_DOCTOR", LANG, SHOW_LIST);

        const names = listed(rows());

        assert(names.some((n) => n.includes(CONTROL_NAME)), `the control is missing too:\n${names}`);
        assert(!names.some((n) => n.includes("A Sharma")), `${status} doctor offered:\n${names}`);
    });
}

Deno.test("an available doctor is still offered", async () => {
    const { send, rows } = build();

    await send("BOOK_DOCTOR", LANG, SHOW_LIST);

    const names = listed(rows());

    assert(names.some((n) => n.includes("A Sharma")), `available doctor dropped:\n${names}`);
    assert(names.some((n) => n.includes(CONTROL_NAME)), `control dropped:\n${names}`);
});

Deno.test("a tap resolved by position lands on the doctor that was shown", async () => {
    // The handler accepts the row number as well as the id, and resolves it
    // against its own fetch. If the list shown and the list resolved against
    // are not the same set, "1" means two different doctors and the patient is
    // booked with someone they did not choose.
    const { supabase, send, current } = build();

    supabase.store.doctors[0].availability_status = "OFFLINE";

    await send("BOOK_DOCTOR", LANG, { type: "text", text: "1" });

    assertEquals(current()?.data?.selectedDoctorId, CONTROL_ID);
});

Deno.test("with every doctor unbookable the patient is told, not left on an empty list", async () => {
    const { supabase, send, said } = build();

    supabase.store.doctors[0].availability_status = "OFFLINE";
    supabase.store.doctors.find((d: any) => d.id === CONTROL_ID)!.takes_online_appointments = false;

    await send("BOOK_DOCTOR", LANG, SHOW_LIST);

    assert(/no doctors/i.test(said()), `no explanation was sent:\n${said()}`);
});

Deno.test("the front desk still sees a walk-ins-only doctor", async () => {
    // The exclusion is for the WhatsApp list only. getDoctors is what the
    // reception endpoint and the doctor portal use, and it must keep returning
    // everyone, or turning the flag on would delete the doctor from the clinic.
    const supabase = fakeSupabase(seed());
    supabase.store.doctors[0].takes_online_appointments = false;

    const { MultiClinicSupabaseClient } = await import("../shared/multi-clinic-supabase-client.ts");
    const client = new MultiClinicSupabaseClient(
        "http://localhost:54321",
        "test-key",
        supabase as any
    );

    const all = await client.getDoctors(CLINIC_A);
    const bookable = await client.getBookableDoctors(CLINIC_A);

    assert(all.some((d: any) => d.id === DOCTOR_A), "the front desk lost the doctor");
    assert(!bookable.some((d: any) => d.id === DOCTOR_A), "WhatsApp still offers the doctor");
});
