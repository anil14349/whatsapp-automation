/**
 * Deactivating a clinic.
 *
 * This used to be close to decorative: nothing on the auth path read
 * `clinics.is_active`, and inbound routing fell through to the default clinic,
 * so deactivating a clinic handed its patients to a different tenant.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
Deno.env.set("WHATSAPP_ACCESS_TOKEN", "env-token");
Deno.env.set("WHATSAPP_PHONE_NUMBER_ID", "env-phone-id");

const { getClinicByPhoneNumberId, clearRouteCache } = await import("../shared/clinic-routing.ts");
const getClinicRoute = getClinicByPhoneNumberId;

function clinics() {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics = [
        {
            id: CLINIC_A,
            name: "Clinic A",
            whatsapp_phone_number_id: "PHONE_A",
            whatsapp_access_token: "token-a",
            is_active: true
        },
        {
            id: CLINIC_B,
            name: "Clinic B",
            whatsapp_phone_number_id: "PHONE_B",
            whatsapp_access_token: "token-b",
            is_active: true
        }
    ];

    return supabase;
}

Deno.test("an active clinic routes to its own credentials", async () => {
    clearRouteCache();
    const supabase = clinics();

    const route = await getClinicRoute(supabase, "PHONE_B");

    assertEquals(route?.clinicId, CLINIC_B);
    assertEquals(route?.accessToken, "token-b");
});

Deno.test("a deactivated clinic is not served by the default clinic", async () => {
    clearRouteCache();
    const supabase = clinics();
    supabase.store.clinics[1].is_active = false;

    const route = await getClinicRoute(supabase, "PHONE_B");

    assertEquals(
        route,
        null,
        "a deactivated clinic's patients were handed to another tenant"
    );
});

Deno.test("an unknown number still falls back to the default clinic", async () => {
    clearRouteCache();
    const supabase = clinics();

    const route = await getClinicRoute(supabase, "PHONE_UNKNOWN");

    assertEquals(route?.clinicId, CLINIC_A);
});

Deno.test("a deactivated default clinic serves nobody", async () => {
    clearRouteCache();
    const supabase = clinics();
    supabase.store.clinics[0].is_active = false;

    assertEquals(await getClinicRoute(supabase, "PHONE_UNKNOWN"), null);
    assertEquals(await getClinicRoute(supabase, "PHONE_A"), null);
});
