/**
 * Deactivating a person.
 *
 * "Deactivate" on the Staff screen only ever blocked the next sign-in. The
 * token already in their browser kept working for the rest of its twelve
 * hours, so someone removed for cause carried on reading and changing
 * appointments. Verified against the live project before this was written:
 * the receptionist's status was INACTIVE, a fresh login was refused, and the
 * same token still returned 200.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { CLINIC_A } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { isAccountActive, clearAccountActiveCache } = await import(
    "../shared/account-status.ts"
);

const DOCTOR_ID = "11111111-1111-1111-1111-111111111111";
const RECEPTIONIST_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "33333333-3333-3333-3333-333333333333";

function staff() {
    const supabase = fakeSupabase({});

    supabase.store.doctors = [{ id: DOCTOR_ID, clinic_id: CLINIC_A, is_active: true }];
    supabase.store.receptionists = [
        { id: RECEPTIONIST_ID, clinic_id: CLINIC_A, status: "ACTIVE" }
    ];
    supabase.store.clinic_admins = [
        { id: ADMIN_ID, clinic_id: CLINIC_A, status: "ACTIVE" }
    ];

    return supabase;
}

const doctor = { userId: DOCTOR_ID, role: "DOCTOR", clinicId: CLINIC_A } as any;
const receptionist = { userId: RECEPTIONIST_ID, role: "RECEPTIONIST", clinicId: CLINIC_A } as any;
const owner = { userId: ADMIN_ID, role: "CLINIC_OWNER", clinicId: CLINIC_A } as any;

Deno.test("an active account is allowed", async () => {
    clearAccountActiveCache();
    const supabase = staff();

    assertEquals(await isAccountActive(doctor, supabase as any), true);
    assertEquals(await isAccountActive(receptionist, supabase as any), true);
    assertEquals(await isAccountActive(owner, supabase as any), true);
});

Deno.test("a deactivated doctor is refused", async () => {
    clearAccountActiveCache();
    const supabase = staff();
    supabase.store.doctors[0].is_active = false;

    assertEquals(await isAccountActive(doctor, supabase as any), false);
});

Deno.test("a receptionist set INACTIVE is refused", async () => {
    clearAccountActiveCache();
    const supabase = staff();
    supabase.store.receptionists[0].status = "INACTIVE";

    assertEquals(await isAccountActive(receptionist, supabase as any), false);
});

Deno.test("a deactivated clinic owner is refused", async () => {
    clearAccountActiveCache();
    const supabase = staff();
    supabase.store.clinic_admins[0].status = "SUSPENDED";

    assertEquals(await isAccountActive(owner, supabase as any), false);
});

Deno.test("a deleted account is refused, not treated as unknown", async () => {
    clearAccountActiveCache();
    const supabase = staff();
    supabase.store.receptionists = [];

    assertEquals(await isAccountActive(receptionist, supabase as any), false);
});

Deno.test("the answer is cached, so a revoke is bounded by the TTL rather than instant", async () => {
    clearAccountActiveCache();
    const supabase = staff();

    assertEquals(await isAccountActive(receptionist, supabase as any), true);

    supabase.store.receptionists[0].status = "INACTIVE";

    // Documents the trade rather than pretending it is immediate.
    assertEquals(await isAccountActive(receptionist, supabase as any), true);

    clearAccountActiveCache();
    assertEquals(await isAccountActive(receptionist, supabase as any), false);
});
