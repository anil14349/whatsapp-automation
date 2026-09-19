/**
 * What happens when staff do not do as they are told.
 *
 * The patient flow has the excuse of being used by strangers. A doctor or a
 * collector is worse off: they use the same three menus all day, so they type
 * ahead, tap a button from this morning's list, and answer a PIN prompt with
 * a word. The same class of mistake lands on a flow that can close somebody
 * else's appointment.
 *
 * What these protect is the silent outcome. Nothing here should crash — it
 * should refuse, say so, and put the menu back.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import {
    seed,
    session,
    textMessage,
    tap,
    today,
    CLINIC_A,
    DOCTOR_A
} from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { hashPassword } from "../shared/bcrypt-password.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DOCTOR_PORTAL_PIN", "123456");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", "true");

const { DoctorFlowHandler } = await import("../shared/handlers/doctor-handler.ts");
const { clearAuthCache } = await import("../shared/doctor-auth.ts");

let counter = 0;

function doctorFlow() {
    clearAuthCache();
    counter += 1;
    const phone = `9197100${String(counter).padStart(5, "0")}`;

    const supabase = fakeSupabase(seed());
    supabase.store.doctors[0].phone = phone;

    const wa = new FakeWhatsAppClient();
    const handler = new DoctorFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const send = async (state: string, data: Record<string, unknown>, message: any) => {
        const sess = session(state, data, CLINIC_A, phone, "DOCTOR");

        supabase.store.whatsapp_sessions = [
            { phone, clinic_id: CLINIC_A, state, data, role: "DOCTOR" }
        ];

        await handler.handle(sess, message);
    };

    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === phone);

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, phone, send, current, said };
}

Deno.test("a doctor typing a word where a PIN belongs stays logged out", async () => {
    const { phone, send, current } = doctorFlow();

    await send("DOCTOR_LOGIN", {}, textMessage("open sesame", phone));

    assertEquals(current()?.state, "DOCTOR_LOGIN");
    assertEquals(current()?.data?.authenticated, undefined);
});

Deno.test("a patient's menu button does not open the doctor portal", async () => {
    // Both flows are reachable from the same handset if a doctor is also a
    // patient of the clinic, and the ids live in one namespace.
    const { phone, send, current } = doctorFlow();

    await send("DOCTOR_LOGIN", {}, tap(BUTTON_IDS.PATIENT_MENU.BOOK, phone));

    assertEquals(current()?.state, "DOCTOR_LOGIN", "a patient id got past the PIN gate");
    assertEquals(current()?.data?.authenticated, undefined);
});

Deno.test("opening hours without a leading zero are refused, not confirmed", async () => {
    const { phone, send, current, said } = doctorFlow();

    await send(
        "DOCTOR_AVAILABILITY",
        { authenticated: true, doctorId: DOCTOR_A, clinicId: CLINIC_A, selectedDay: 1 },
        textMessage("9:00-17:00", phone)
    );

    // Asserting nothing was written would pass either way: a good range is not
    // written here either, it is offered back for confirmation first. The
    // difference between accepted and refused is which of those two happens.
    assert(!/confirm availability/i.test(said()), `a bad range reached the confirm step:\n${said()}`);
    assert(/format/i.test(said()), `the doctor was not told why:\n${said()}`);
    assertEquals(current()?.state, "DOCTOR_AVAILABILITY", "must stay and re-ask");
});

Deno.test("a day that ends before it starts is refused", async () => {
    const { phone, send, said } = doctorFlow();

    await send(
        "DOCTOR_AVAILABILITY",
        { authenticated: true, doctorId: DOCTOR_A, clinicId: CLINIC_A, selectedDay: 1 },
        textMessage("18:00-09:00", phone)
    );

    assert(!/confirm availability/i.test(said()), `a backwards day reached the confirm step:\n${said()}`);
});

Deno.test("a status that is neither Completed nor No-Show changes nothing", async () => {
    const { phone, send, supabase } = doctorFlow();

    supabase.store.appointments = [
        {
            id: "APT_1",
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_name: "Anil",
            appointment_date: today(),
            appointment_time: "10:00",
            status: "CONFIRMED"
        }
    ];

    await send(
        "DOCTOR_MARK_STATUS_CONFIRM",
        {
            authenticated: true,
            doctorId: DOCTOR_A,
            clinicId: CLINIC_A,
            selectedAppointmentId: "APT_1",
            selectedPatientName: "Anil"
        },
        textMessage("done i think", phone)
    );

    assertEquals(
        supabase.rows("appointments")[0].status,
        "CONFIRMED",
        "a sentence was read as a status"
    );
});

// ── Collector ────────────────────────────────────────────────────────────────

const COLLECTOR = "919000000077";
const PIN = "8317";
const PIN_HASH = await hashPassword(PIN);

function collectorFlow(state = "COLLECTOR_MENU", data: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());

    supabase.store.sample_collectors = [
        {
            id: "col-1",
            clinic_id: CLINIC_A,
            name: "Ravi",
            phone: COLLECTOR,
            is_active: true,
            pin_hash: PIN_HASH
        }
    ];

    supabase.store.appointments = [
        {
            id: "APT_HOME_1",
            clinic_id: CLINIC_A,
            patient_phone: "919000000001",
            patient_name: "Anil",
            appointment_date: today(),
            appointment_time: "10:00",
            location_type: "HOME",
            status: "CONFIRMED",
            service_address: "Flat 3B, above the chemist",
            collector_id: "col-1"
        }
    ];

    supabase.store.whatsapp_sessions = [
        {
            phone: COLLECTOR,
            clinic_id: CLINIC_A,
            state,
            data,
            role: "HOME_COLLECTION_PERSON"
        }
    ];

    const wa = new FakeWhatsAppClient();

    const send = (text: string, messageType = "interactive") =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: COLLECTOR,
            senderName: "Ravi",
            messageText: text,
            messageType,
            clinicId: CLINIC_A
        });

    const appointment = () => supabase.rows("appointments")[0];

    return { supabase, wa, send, appointment };
}

Deno.test("a collector typing at the round gets the round back, not an error", async () => {
    const { send, wa, appointment } = collectorFlow();

    await send("where is the next one", "text");

    assertEquals(appointment().status, "CONFIRMED", "a sentence closed a visit");
    assert(
        wa.sent.some((m) => m.type === "list" || m.type === "buttons"),
        "the collector was left with no way forward"
    );
});

Deno.test("anything but Yes leaves the visit open", async () => {
    const { send, appointment } = collectorFlow("COLLECTOR_CONFIRM", {
        selectedVisitId: "APT_HOME_1"
    });

    await send("ok done", "text");

    assertEquals(
        appointment().status,
        "CONFIRMED",
        "free text at the confirmation was taken as a yes"
    );
});

Deno.test("a patient's menu button does not close a visit", async () => {
    const { send, appointment } = collectorFlow("COLLECTOR_CONFIRM", {
        selectedVisitId: "APT_HOME_1"
    });

    await send(BUTTON_IDS.PATIENT_MENU.BOOK);

    assertEquals(appointment().status, "CONFIRMED");
});

Deno.test("a visit button for something that is not on the round is refused", async () => {
    const { send, wa, appointment } = collectorFlow();

    await send("visit_APT_DOES_NOT_EXIST");

    assertEquals(appointment().status, "CONFIRMED");
    assert(
        wa.sent.length > 0,
        "the collector tapped and nothing at all came back"
    );
});
