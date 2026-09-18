/**
 * Deactivating a person, or their clinic.
 *
 * "Deactivate" on the Staff screen only ever blocked the next sign-in. The
 * token already in their browser kept working for the rest of its twelve
 * hours, so someone removed for cause carried on reading and changing
 * appointments. Verified against the live project before this was written:
 * the receptionist's status was INACTIVE, a fresh login was refused, and the
 * same token still returned 200.
 *
 * These run against checkAccess, which is what withAuth calls on every
 * request. They used to run against isAccountActive, which withAuth stopped
 * calling when the two checks were folded into one query - so they would have
 * passed while saying nothing about the live path.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { CLINIC_A } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { checkAccess, clearAccessCache } = await import("../shared/access-check.ts");

const DOCTOR_ID = "11111111-1111-1111-1111-111111111111";
const RECEPTIONIST_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "33333333-3333-3333-3333-333333333333";

/**
 * The fake ignores select(), so the embedded clinic is shaped onto the row the
 * way PostgREST returns it.
 */
function staff(clinicActive = true) {
    const supabase = fakeSupabase({});
    const clinic = { is_active: clinicActive };

    supabase.store.doctors = [
        { id: DOCTOR_ID, clinic_id: CLINIC_A, is_active: true, clinic }
    ];
    supabase.store.receptionists = [
        { id: RECEPTIONIST_ID, clinic_id: CLINIC_A, status: "ACTIVE", clinic }
    ];
    supabase.store.clinic_admins = [
        { id: ADMIN_ID, clinic_id: CLINIC_A, status: "ACTIVE", clinic }
    ];

    return supabase;
}

const doctor = { userId: DOCTOR_ID, role: "DOCTOR", clinicId: CLINIC_A } as any;
const receptionist = { userId: RECEPTIONIST_ID, role: "RECEPTIONIST", clinicId: CLINIC_A } as any;
const owner = { userId: ADMIN_ID, role: "CLINIC_OWNER", clinicId: CLINIC_A } as any;

Deno.test("an active account at an active clinic is allowed", async () => {
    clearAccessCache();
    const supabase = staff();

    for (const user of [doctor, receptionist, owner]) {
        const answer = await checkAccess(user, supabase as any);
        assertEquals(answer, { clinicActive: true, accountActive: true });
    }
});

Deno.test("a deactivated doctor is refused", async () => {
    clearAccessCache();
    const supabase = staff();
    supabase.store.doctors[0].is_active = false;

    assertEquals((await checkAccess(doctor, supabase as any)).accountActive, false);
});

Deno.test("a receptionist set INACTIVE is refused", async () => {
    clearAccessCache();
    const supabase = staff();
    supabase.store.receptionists[0].status = "INACTIVE";

    assertEquals((await checkAccess(receptionist, supabase as any)).accountActive, false);
});

Deno.test("a deactivated clinic owner is refused", async () => {
    clearAccessCache();
    const supabase = staff();
    supabase.store.clinic_admins[0].status = "SUSPENDED";

    assertEquals((await checkAccess(owner, supabase as any)).accountActive, false);
});

Deno.test("a deleted account is refused, not treated as unknown", async () => {
    clearAccessCache();
    const supabase = staff();
    supabase.store.receptionists = [];

    assertEquals((await checkAccess(receptionist, supabase as any)).accountActive, false);
});

Deno.test("an active account at a deactivated clinic is refused", async () => {
    clearAccessCache();
    const supabase = staff(false);

    const answer = await checkAccess(receptionist, supabase as any);

    assertEquals(answer.accountActive, true);
    assertEquals(answer.clinicActive, false);
});

Deno.test("a platform admin has no clinic to check", async () => {
    clearAccessCache();
    const supabase = staff();
    supabase.store.clinic_admins = [{ id: ADMIN_ID, clinic_id: null, status: "ACTIVE" }];

    const answer = await checkAccess(
        { userId: ADMIN_ID, role: "ADMIN", clinicId: undefined } as any,
        supabase as any
    );

    assertEquals(answer, { clinicActive: true, accountActive: true });
});

Deno.test("the answer is cached, so a revoke is bounded by the TTL rather than instant", async () => {
    clearAccessCache();
    const supabase = staff();

    assertEquals((await checkAccess(receptionist, supabase as any)).accountActive, true);

    supabase.store.receptionists[0].status = "INACTIVE";

    // Documents the trade rather than pretending it is immediate.
    assertEquals((await checkAccess(receptionist, supabase as any)).accountActive, true);

    clearAccessCache();
    assertEquals((await checkAccess(receptionist, supabase as any)).accountActive, false);
});
