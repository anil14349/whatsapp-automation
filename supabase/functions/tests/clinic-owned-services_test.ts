/**
 * Services a clinic adds for itself.
 *
 * service_types used to be a shared catalogue and so was safe by construction.
 * Once a row can belong to one clinic, every direct read of the table is a
 * cross-tenant path, and a lookup by code can match more than one row.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { getEnabledServices, clearClinicServiceCache } = await import(
    "../shared/clinic-services.ts"
);

const SHARED = {
    id: "t-consult",
    code: "CONSULTATION",
    name: "Doctor Consultation",
    category: "CONSULTATION",
    clinic_id: null,
    default_clinic_price: 500,
    default_home_price: 750,
    default_duration_minutes: 30,
    is_active: true
};

// Both clinics chose the same name, which the old global unique code forbade.
const A_DENTAL = {
    id: "t-dental-a",
    code: "DENTAL_CHECK_UP",
    name: "Dental Check-up",
    category: "CONSULTATION",
    clinic_id: CLINIC_A,
    default_clinic_price: 600,
    default_home_price: null,
    default_duration_minutes: 30,
    is_active: true
};

const B_DENTAL = {
    id: "t-dental-b",
    code: "DENTAL_CHECK_UP",
    name: "Dental Check-up",
    category: "CONSULTATION",
    clinic_id: CLINIC_B,
    default_clinic_price: 900,
    default_home_price: null,
    default_duration_minutes: 45,
    is_active: true
};

function link(clinicId: string, type: Record<string, unknown>) {
    return {
        clinic_id: clinicId,
        service_type_id: type.id,
        is_enabled: true,
        offered_at_clinic: true,
        offered_at_home: false,
        requires_doctor: true,
        clinic_price: null,
        home_price: null,
        duration_minutes: null,
        concurrent_capacity: 1,
        display_order: 0,
        service_type: type
    };
}

function bothClinics() {
    const supabase = fakeSupabase(seed());

    const flags = {
        enable_doctor_consultations: true,
        enable_diagnostic_center: true,
        enable_home_collection: true,
        enable_doctor_home_visits: true
    };

    supabase.store.clinics = [
        { id: CLINIC_A, name: "Clinic A", ...flags },
        { id: CLINIC_B, name: "Clinic B", ...flags }
    ];

    supabase.store.service_types = [SHARED, A_DENTAL, B_DENTAL];

    supabase.store.clinic_services = [
        link(CLINIC_A, SHARED),
        link(CLINIC_A, A_DENTAL),
        link(CLINIC_B, SHARED),
        link(CLINIC_B, B_DENTAL)
    ];

    clearClinicServiceCache();

    return supabase;
}

Deno.test("a clinic sees the shared catalogue plus its own services", async () => {
    const supabase = bothClinics();

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services.map((s) => s.serviceTypeId).sort(), ["t-consult", "t-dental-a"]);
});

Deno.test("a clinic never sees another clinic's private service", async () => {
    const supabase = bothClinics();

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(
        services.some((s) => s.serviceTypeId === "t-dental-b"),
        false,
        "one clinic's private service reached another"
    );
});

Deno.test("two clinics can use the same name and price it differently", async () => {
    const supabase = bothClinics();

    const a = await getEnabledServices(supabase, CLINIC_A, "clinic");
    const b = await getEnabledServices(supabase, CLINIC_B, "clinic");

    const aDental = a.find((s) => s.name === "Dental Check-up");
    const bDental = b.find((s) => s.name === "Dental Check-up");

    assertEquals(aDental?.clinicPrice, 600);
    assertEquals(bDental?.clinicPrice, 900);
    assertEquals(aDental?.serviceTypeId === bDental?.serviceTypeId, false);
});

Deno.test("a private service that is switched off is not offered", async () => {
    const supabase = bothClinics();
    supabase.store.clinic_services[1].is_enabled = false;

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(services.map((s) => s.serviceTypeId), ["t-consult"]);
});

Deno.test("a private service still obeys its category's master switch", async () => {
    const supabase = bothClinics();
    supabase.store.clinics[0].enable_doctor_consultations = false;

    const services = await getEnabledServices(supabase, CLINIC_A, "clinic");

    assertEquals(
        services.length,
        0,
        "a clinic's own consultation ignored the consultations switch"
    );
});
