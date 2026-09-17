/**
 * The offering this clinic actually runs: see a doctor at the clinic, or have
 * a sample collected at home.
 *
 * Doctor home visits are switched off, and the switch that does it is shared
 * machinery — `enable_home_collection` governs every non-consultation at home,
 * so reaching for the wrong one would take sample collection down with it.
 * These tests pin both halves so a future change to one cannot quietly move
 * the other.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, textMessage, tap, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { BUTTON_IDS, serviceButtonId } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");
const { clearClinicServiceCache } = await import("../shared/clinic-services.ts");

const CONSULT = "svc-consult-id";
const SAMPLE = "svc-sample-id";

const TYPES = [
    {
        id: CONSULT,
        code: "CONSULTATION",
        name: "Doctor Consultation",
        category: "CONSULTATION",
        default_clinic_price: 500,
        default_home_price: 750,
        default_duration_minutes: 30,
        is_active: true
    },
    {
        id: SAMPLE,
        code: "SAMPLE_COLLECTION",
        name: "Sample Collection",
        category: "DIAGNOSTIC",
        default_clinic_price: 100,
        default_home_price: 150,
        default_duration_minutes: 10,
        is_active: true
    }
];

/** Mirrors the live clinic_services rows for this clinic. */
function serviceRow(typeId: string, overrides: Record<string, unknown> = {}) {
    return {
        clinic_id: CLINIC_A,
        service_type_id: typeId,
        is_enabled: true,
        offered_at_clinic: true,
        offered_at_home: true,
        requires_doctor: typeId === CONSULT,
        clinic_price: null,
        home_price: null,
        duration_minutes: null,
        concurrent_capacity: 1,
        display_order: typeId === CONSULT ? 0 : 1,
        service_type: TYPES.find((t) => t.id === typeId),
        ...overrides
    };
}

function build(flags: Record<string, boolean> = {}) {
    const supabase = fakeSupabase(seed());

    Object.assign(supabase.store.clinics[0], {
        enable_doctor_consultations: true,
        enable_diagnostic_center: true,
        enable_home_collection: true,
        // What this change turns off.
        enable_doctor_home_visits: false,
        latitude: 28.6139,
        longitude: 77.209,
        home_collection_radius_km: 10,
        ...flags
    });

    supabase.store.service_types = TYPES;
    supabase.store.clinic_services = [serviceRow(CONSULT), serviceRow(SAMPLE)];

    clearClinicServiceCache();

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

    const buttonIds = () => wa.sent.flatMap((m) => (m.buttons ?? []).map((b) => b.id));

    // Doctors and services arrive as tappable options, not in the message body.
    const options = () =>
        wa.sent.flatMap((m) => [
            ...(m.buttons ?? []).map((b) => b.title),
            ...(m.sections ?? []).flatMap((s) => s.rows.map((r) => r.title))
        ]);

    return { supabase, wa, send, current, said, buttonIds, options };
}

Deno.test("a consultation is never offered at the patient's home", async () => {
    const { send, current, said } = build();

    await send("SERVICE_SELECT", { language: "EN" }, tap(serviceButtonId(CONSULT)));

    assertEquals(
        current()?.state,
        "BOOK_DOCTOR",
        "a consultation still asked where, with home visits switched off"
    );

    assert(
        !/Where would you like this/i.test(said()),
        `the patient was offered a home visit: ${said()}`
    );
});

Deno.test("a consultation at the clinic is untouched by the home visit switch", async () => {
    const { send, options } = build();

    await send("SERVICE_SELECT", { language: "EN" }, tap(serviceButtonId(CONSULT)));

    // Reaching a bookable doctor is the whole point of leaving the clinic on.
    assert(
        options().some((title) => /Sharma/i.test(title)),
        `no doctor was offered: ${JSON.stringify(options())}`
    );
});

Deno.test("turning doctor home visits back on restores the choice", async () => {
    // Proves the test above is testing the switch and not something incidental,
    // and that this is reversible by flipping one column back.
    const { send, current } = build({ enable_doctor_home_visits: true });

    await send("SERVICE_SELECT", { language: "EN" }, tap(serviceButtonId(CONSULT)));

    assertEquals(current()?.state, "BOOK_LOCATION");
});

Deno.test("sample collection still asks the patient where they want it", async () => {
    const { send, current, said } = build();

    await send("SERVICE_SELECT", { language: "EN" }, tap(serviceButtonId(SAMPLE)));

    assertEquals(current()?.state, "BOOK_LOCATION");
    assert(/Where would you like this/i.test(said()), said());
});

Deno.test("choosing home for a sample collection asks for an address", async () => {
    const { send, current } = build();

    await send(
        "BOOK_LOCATION",
        { language: "EN", serviceTypeId: SAMPLE, serviceName: "Sample Collection", requiresDoctor: false },
        tap(BUTTON_IDS.LOCATION_TYPE.HOME)
    );

    assertEquals(current()?.state, "BOOK_ADDRESS");
});

Deno.test("the main menu still offers home collection", async () => {
    const { send, buttonIds } = build();

    await send("MAIN_MENU", { language: "EN" }, textMessage("something unrecognised"));

    assert(
        buttonIds().includes(BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION),
        `home collection disappeared from the menu: ${JSON.stringify(buttonIds())}`
    );
});

Deno.test("the menu drops home collection only when nothing is offered at home", async () => {
    // The failure worth catching: switching off home collection to stop doctor
    // home visits, and taking sample collection with it.
    const { send, buttonIds } = build({ enable_home_collection: false });

    await send("MAIN_MENU", { language: "EN" }, textMessage("something unrecognised"));

    assert(
        !buttonIds().includes(BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION),
        "home collection was offered with every home service switched off"
    );
});

Deno.test("home collection books an appointment, not an orphan request", async () => {
    // It used to enter LOCATION_SELECT, a parallel flow writing to
    // home_collection_requests - a table no portal screen reads.
    const { send, current } = build();

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION));

    assertEquals(current()?.state, "BOOK_ADDRESS");
    assertEquals(current()?.data?.serviceTypeId, SAMPLE);
    assertEquals(current()?.data?.locationType, "HOME");
});

Deno.test("home collection asks for a pin and says why", async () => {
    const { send, said } = build();

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION));

    assert(/share your location/i.test(said()), said());
    assert(/typed address cannot be used/i.test(said()), said());
});

Deno.test("home collection never asks the patient where they want it", async () => {
    // They have already answered that by tapping the button.
    const { send, said } = build();

    await send("MAIN_MENU", { language: "EN" }, tap(BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION));

    assert(!/Where would you like this/i.test(said()), said());
});

Deno.test("a service switched off by its master switch cannot be booked by a stale tap", async () => {
    // offered_at_clinic stays true, so only the master switch refuses it.
    const { send, current, said } = build({ enable_doctor_consultations: false });

    await send("SERVICE_SELECT", { language: "EN" }, tap(serviceButtonId(CONSULT)));

    assertEquals(current()?.state, "MAIN_MENU");
    assert(/not available at this clinic/i.test(said()), said());
});
