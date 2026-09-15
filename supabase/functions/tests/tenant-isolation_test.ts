/**
 * Tenant isolation.
 *
 * Every bug in this area was silent and cross-clinic: one clinic's webhook
 * token wrote into another's data, and a doctor at clinic A was treated as a
 * doctor at clinic B. These tests assert the boundaries directly.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B, DOCTOR_PHONE } from "./helpers/fixtures.ts";

Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
Deno.env.set("WHATSAPP_ACCESS_TOKEN", "ENV_TOKEN");
Deno.env.set("WHATSAPP_PHONE_NUMBER_ID", "ENV_PHONE");
Deno.env.set("DOCTOR_PHONES", "919000000077");
Deno.env.set("SAMPLE_COLLECTOR_PHONES", "919000000088");

const { getClinicByPhoneNumberId, getClinicIdByWebhookToken, getActiveClinicRoutes, isValidVerifyToken } =
    await import("../shared/clinic-routing.ts");
const { getRoleByPhoneForClinic, getCollectorsForClinic } = await import(
    "../shared/staff-directory.ts"
);

function db() {
    // Routing caches for 60s keyed by value, so each test needs fresh ids.
    return fakeSupabase(seed());
}

Deno.test("a phone number id resolves to its own clinic's credentials", async () => {
    const supabase = db();

    const routeA = await getClinicByPhoneNumberId(supabase, "PHONE_A");
    const routeB = await getClinicByPhoneNumberId(supabase, "PHONE_B");

    assertEquals(routeA?.clinicId, CLINIC_A);
    assertEquals(routeA?.accessToken, "TOKEN_A");
    assertEquals(routeB?.clinicId, CLINIC_B);
    assertEquals(routeB?.accessToken, "TOKEN_B");
});

Deno.test("a webhook token maps only to the clinic that owns it", async () => {
    const supabase = db();

    assertEquals(await getClinicIdByWebhookToken(supabase, "HOOK_A"), CLINIC_A);
    assertEquals(await getClinicIdByWebhookToken(supabase, "HOOK_B"), CLINIC_B);
});

Deno.test("an unknown webhook token maps to no clinic", async () => {
    const supabase = db();

    assertEquals(await getClinicIdByWebhookToken(supabase, "HOOK_UNKNOWN"), null);
});

Deno.test("a verify token is accepted for any clinic that owns one", async () => {
    const supabase = db();

    assertEquals(await isValidVerifyToken(supabase, "VERIFY_A"), true);
    assertEquals(await isValidVerifyToken(supabase, "VERIFY_B"), true);
    assertEquals(await isValidVerifyToken(supabase, "VERIFY_NOBODY"), false);
});

Deno.test("the scheduler sees every active clinic with its own credentials", async () => {
    const supabase = db();

    const routes = await getActiveClinicRoutes(supabase);

    assertEquals(routes.length, 2);
    assertEquals(
        routes.map((r) => [r.clinicId, r.accessToken, r.phoneNumberId]).sort(),
        [
            [CLINIC_A, "TOKEN_A", "PHONE_A"],
            [CLINIC_B, "TOKEN_B", "PHONE_B"]
        ].sort()
    );
});

Deno.test("an inactive clinic is not scheduled", async () => {
    const supabase = fakeSupabase(seed());
    supabase.store.clinics[1].is_active = false;

    const routes = await getActiveClinicRoutes(supabase);

    assertEquals(routes.map((r) => r.clinicId), [CLINIC_A]);
});

Deno.test("a doctor at one clinic is a patient at another", async () => {
    const supabase = db();

    assertEquals(await getRoleByPhoneForClinic(supabase, DOCTOR_PHONE, CLINIC_A), "DOCTOR");
    assertEquals(await getRoleByPhoneForClinic(supabase, DOCTOR_PHONE, CLINIC_B), "PATIENT");
});

Deno.test("an inactive doctor loses staff access", async () => {
    const supabase = fakeSupabase(seed());
    supabase.store.doctors[0].is_active = false;

    assertEquals(await getRoleByPhoneForClinic(supabase, DOCTOR_PHONE, CLINIC_A), "PATIENT");
});

Deno.test("env staff lists apply only to the default clinic", async () => {
    const supabase = db();

    // 919000000077 is in DOCTOR_PHONES; CLINIC_A is DEFAULT_CLINIC_ID.
    assertEquals(await getRoleByPhoneForClinic(supabase, "919000000077", CLINIC_A), "DOCTOR");
    assertEquals(await getRoleByPhoneForClinic(supabase, "919000000077", CLINIC_B), "PATIENT");

    assertEquals(
        await getRoleByPhoneForClinic(supabase, "919000000088", CLINIC_A),
        "HOME_COLLECTION_PERSON"
    );
    assertEquals(await getRoleByPhoneForClinic(supabase, "919000000088", CLINIC_B), "PATIENT");
});

Deno.test("an unknown number is always a patient", async () => {
    const supabase = db();

    assertEquals(await getRoleByPhoneForClinic(supabase, "919999999999", CLINIC_A), "PATIENT");
});

Deno.test("collectors are listed per clinic", async () => {
    const supabase = fakeSupabase(seed());
    supabase.store.sample_collectors = [
        { id: "c1", clinic_id: CLINIC_A, phone: "919100000001", name: "Raj", is_active: true, max_per_day: 5 },
        { id: "c2", clinic_id: CLINIC_B, phone: "919100000002", name: "Priya", is_active: true, max_per_day: 5 }
    ];

    const forA = await getCollectorsForClinic(supabase, CLINIC_A);
    const forB = await getCollectorsForClinic(supabase, CLINIC_B);

    assertEquals(forA.map((c) => c.phone), ["919100000001"]);
    assertEquals(forB.map((c) => c.phone), ["919100000002"]);
});
