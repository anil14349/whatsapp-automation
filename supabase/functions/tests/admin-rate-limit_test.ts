/**
 * Locking an account after repeated failures.
 *
 * Admins were missing from this entirely. `login_rate_limits.user_type` was
 * constrained to doctor and receptionist, so a failed admin attempt violated
 * the check and was quietly discarded — and the account that creates staff,
 * changes every setting and reads the clinic's figures was the only one whose
 * password could be guessed at indefinitely. Found by trying to lock a test
 * admin out and signing straight back in.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { CLINIC_A } from "./helpers/fixtures.ts";
import {
    clearFailedAttempts,
    isRateLimited,
    recordFailedAttempt,
    DEFAULT_RATE_LIMIT
} from "../shared/rate-limiting.ts";

const ADMIN = "aaaaaaaa-1111-2222-3333-444444444444";

function store() {
    return fakeSupabase({ login_rate_limits: [] });
}

Deno.test("an admin is not locked out before they have failed", async () => {
    assertEquals(await isRateLimited(store() as any, ADMIN, "admin"), false);
});

Deno.test("three failures lock an admin, two do not", async () => {
    const supabase = store();

    assertEquals(await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A), false);
    assertEquals(await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A), false);

    assertEquals(
        await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A),
        true,
        `the lockout should fire on attempt ${DEFAULT_RATE_LIMIT.maxAttempts}`
    );

    assertEquals(await isRateLimited(supabase as any, ADMIN, "admin"), true);
});

Deno.test("a platform admin has no clinic and is still counted", async () => {
    const supabase = store();

    // clinic_id NOT NULL was the other half of why this could not work.
    await recordFailedAttempt(supabase as any, ADMIN, "admin", null);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", null);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", null);

    assertEquals(await isRateLimited(supabase as any, ADMIN, "admin"), true);

    const rows = supabase.rows("login_rate_limits");

    assertEquals(rows.length, 1, "a null clinic must not produce a row per attempt");
    assertEquals(rows[0].clinic_id, null);
});

Deno.test("signing in successfully clears the count", async () => {
    const supabase = store();

    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);
    await clearFailedAttempts(supabase as any, ADMIN, "admin");

    // Two more must not tip it over: the count restarted.
    assertEquals(await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A), false);
    assertEquals(await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A), false);
    assertEquals(await isRateLimited(supabase as any, ADMIN, "admin"), false);
});

Deno.test("one person's failures do not lock another", async () => {
    const supabase = store();
    const other = "bbbbbbbb-1111-2222-3333-444444444444";

    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);

    assertEquals(await isRateLimited(supabase as any, other, "admin"), false);
});

Deno.test("the same id as a different kind of account is a different account", async () => {
    const supabase = store();

    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);
    await recordFailedAttempt(supabase as any, ADMIN, "admin", CLINIC_A);

    assertEquals(await isRateLimited(supabase as any, ADMIN, "doctor"), false);
});
