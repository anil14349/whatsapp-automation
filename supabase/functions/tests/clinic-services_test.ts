/**
 * Which services a clinic offers, and what the patient menu does about it.
 *
 * The menu is the risky part: WhatsApp throws above three buttons and refuses
 * more than ten list rows, so a clinic enabling a few more services could take
 * the bot down rather than degrade.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { getEnabledServices, getServiceById, clearClinicServiceCache } = await import(
    "../shared/clinic-services.ts"
);

const TYPES = [
    { id: "t-consult", code: "CONSULTATION", name: "Doctor Consultation", category: "CONSULTATION", default_clinic_price: 500, default_home_price: 750, default_duration_minutes: 30, is_active: true },
    { id: "t-blood", code: "BLOOD_TEST", name: "Blood Test", category: "DIAGNOSTIC", default_clinic_price: 200, default_home_price: 300, default_duration_minutes: 15, is_active: true },
    { id: "t-vaccine", code: "VACCINE", name: "Vaccine", category: "VACCINE", default_clinic_price: 300, default_home_price: 450, default_duration_minutes: 10, is_active: true },
    { id: "t-imaging", code: "IMAGING", name: "Medical Imaging", category: "IMAGING", default_clinic_price: 1500, default_home_price: null, default_duration_minutes: 45, is_active: true },
    { id: "t-sample", code: "SAMPLE_COLLECTION", name: "Sample Collection", category: "DIAGNOSTIC", default_clinic_price: 100, default_home_price: 150, default_duration_minutes: 10, is_active: true }
];

function row(clinicId: string, typeId: string, overrides: Record<string, unknown> = {}) {
    return {
        clinic_id: clinicId,
        service_type_id: typeId,
        is_enabled: true,
        offered_at_clinic: true,
        offered_at_home: false,
        requires_doctor: true,
        clinic_price: null,
        home_price: null,
        duration_minutes: null,
        concurrent_capacity: 1,
        display_order: 0,
        service_type: TYPES.find((t) => t.id === typeId),
        ...overrides
    };
}

function withServices(rows: Record<string, unknown>[], flags: Record<string, boolean> = {}) {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics = [
        {
            id: CLINIC_A,
            name: "Clinic A",
            enable_doctor_consultations: true,
            enable_diagnostic_center: true,
            enable_home_collection: true,
            enable_doctor_home_visits: true,
            ...flags
        }
    ];

    supabase.store.service_types = TYPES;
    supabase.store.clinic_services = rows;

    clearClinicServiceCache();

    return supabase;
}

Deno.test("a clinic offering one service returns exactly that", async () => {
    const supabase = withServices([row(CLINIC_A, "t-consult")]);

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services.length, 1);
    assertEquals(services[0].code, "CONSULTATION");
});

Deno.test("a disabled service is not offered", async () => {
    const supabase = withServices([
        row(CLINIC_A, "t-consult"),
        row(CLINIC_A, "t-blood", { is_enabled: false })
    ]);

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services.map((s) => s.code), ["CONSULTATION"]);
});

Deno.test("the diagnostics master switch overrides per-service selection", async () => {
    const supabase = withServices(
        [row(CLINIC_A, "t-consult"), row(CLINIC_A, "t-blood")],
        { enable_diagnostic_center: false }
    );

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(
        services.map((s) => s.code),
        ["CONSULTATION"],
        "a switched-off diagnostic centre still offered a diagnostic"
    );
});

Deno.test("switching off consultations leaves diagnostics alone", async () => {
    const supabase = withServices(
        [row(CLINIC_A, "t-consult"), row(CLINIC_A, "t-blood")],
        { enable_doctor_consultations: false }
    );

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services.map((s) => s.code), ["BLOOD_TEST"]);
});

Deno.test("home collection off removes home services but not clinic ones", async () => {
    const supabase = withServices(
        [row(CLINIC_A, "t-sample", { offered_at_home: true, requires_doctor: false })],
        { enable_home_collection: false }
    );

    assertEquals((await getEnabledServices(supabase, CLINIC_A, "home")).length, 0);
    assertEquals((await getEnabledServices(supabase, CLINIC_A, "clinic")).length, 1);
});

Deno.test("a home visit follows the doctor home visit switch, not home collection", async () => {
    const supabase = withServices(
        [row(CLINIC_A, "t-consult", { offered_at_home: true })],
        { enable_doctor_home_visits: false, enable_home_collection: true }
    );

    assertEquals((await getEnabledServices(supabase, CLINIC_A, "home")).length, 0);
});

Deno.test("a null price inherits the catalogue price rather than being free", async () => {
    const supabase = withServices([row(CLINIC_A, "t-consult")]);

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services[0].clinicPrice, 500);
    assertEquals(services[0].durationMinutes, 30);
});

Deno.test("an override wins over the catalogue default", async () => {
    const supabase = withServices([
        row(CLINIC_A, "t-consult", { clinic_price: 750, duration_minutes: 20 })
    ]);

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services[0].clinicPrice, 750);
    assertEquals(services[0].durationMinutes, 20);
});

Deno.test("one clinic's services do not leak into another's", async () => {
    const supabase = withServices([
        row(CLINIC_A, "t-consult"),
        row(CLINIC_B, "t-blood")
    ]);

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services.map((s) => s.code), ["CONSULTATION"]);
});

Deno.test("a service from another clinic cannot be resolved by id", async () => {
    const supabase = withServices([
        row(CLINIC_A, "t-consult"),
        row(CLINIC_B, "t-blood")
    ]);

    assertEquals(await getServiceById(supabase, CLINIC_A, "t-blood"), null);
});

Deno.test("a clinic with nothing configured offers nothing", async () => {
    const supabase = withServices([]);

    assertEquals((await getEnabledServices(supabase, CLINIC_A, "clinic")).length, 0);
});

Deno.test("the whole catalogue still fits WhatsApp's ten row limit", async () => {
    const supabase = withServices(TYPES.map((t) => row(CLINIC_A, t.id)));

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(
        services.length <= 10,
        true,
        "a service list over ten rows is refused by WhatsApp outright"
    );
});
