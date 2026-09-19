/**
 * The lockout counter under concurrency.
 *
 * recordFailure read the count, added one in JavaScript and wrote it back, so
 * two failures arriving together both read 2 and both wrote 3. The third
 * attempt never reached the threshold and the lockout never fired. Someone
 * guessing a PIN sends requests together on purpose, so this is a control that
 * could be switched off by the attacker rather than a rare accident.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import {
    recordFailure,
    isLockedOut,
    attemptsRemaining,
    clearFailures
} from "../shared/login-attempts.ts";
import { recordFailedAttempt, DEFAULT_RATE_LIMIT } from "../shared/rate-limiting.ts";
import { PIN_CONFIG } from "../shared/config.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

function build() {
    const supabase = fakeSupabase(seed());
    supabase.store.login_rate_limits = [];
    return supabase;
}

const rows = (supabase: any) => supabase.rows("login_rate_limits");

Deno.test("each failure counts once", async () => {
    const supabase = build();

    await recordFailure(supabase as any, DOCTOR_A, "doctor", CLINIC_A);
    await recordFailure(supabase as any, DOCTOR_A, "doctor", CLINIC_A);

    assertEquals(rows(supabase).length, 1, "one row per account");
    assertEquals(rows(supabase)[0].failed_attempts, 2);
});

Deno.test("the threshold locks the account", async () => {
    const supabase = build();

    for (let i = 0; i < PIN_CONFIG.MAX_ATTEMPTS; i++) {
        await recordFailure(supabase as any, DOCTOR_A, "doctor", CLINIC_A);
    }

    assertEquals(await isLockedOut(supabase as any, DOCTOR_A, "doctor"), true);
    assertEquals(await attemptsRemaining(supabase as any, DOCTOR_A, "doctor"), 0);
});

Deno.test("failures arriving together are not lost", async () => {
    // The whole point. Fired without awaiting in between, which is what two
    // requests hitting the function at once look like.
    const supabase = build();

    await Promise.all(
        Array.from({ length: PIN_CONFIG.MAX_ATTEMPTS }, () =>
            recordFailure(supabase as any, DOCTOR_A, "doctor", CLINIC_A)
        )
    );

    assertEquals(rows(supabase).length, 1, "concurrent creates made a second row");
    assertEquals(
        rows(supabase)[0].failed_attempts,
        PIN_CONFIG.MAX_ATTEMPTS,
        "an attempt was lost, so the lockout can be outrun by sending them together"
    );
    assertEquals(await isLockedOut(supabase as any, DOCTOR_A, "doctor"), true);
});

Deno.test("a successful sign-in clears the count", async () => {
    const supabase = build();

    await recordFailure(supabase as any, DOCTOR_A, "doctor", CLINIC_A);
    await clearFailures(supabase as any, DOCTOR_A, "doctor");

    assertEquals(await isLockedOut(supabase as any, DOCTOR_A, "doctor"), false);
    assertEquals(
        await attemptsRemaining(supabase as any, DOCTOR_A, "doctor"),
        PIN_CONFIG.MAX_ATTEMPTS
    );
});

Deno.test("two accounts do not share a counter", async () => {
    const supabase = build();

    await recordFailure(supabase as any, DOCTOR_A, "doctor", CLINIC_A);
    await recordFailure(supabase as any, "someone-else", "doctor", CLINIC_A);

    assertEquals(rows(supabase).length, 2);
    assert(
        rows(supabase).every((r: any) => r.failed_attempts === 1),
        "one account's failure was counted against the other"
    );
});

Deno.test("the portal logins count concurrent failures too", async () => {
    // The three REST logins use rate-limiting.ts, not login-attempts.ts, and
    // had the same read-then-write. They are the endpoints reachable without
    // a WhatsApp number, so they are the easier target.
    const supabase = build();

    const locked = await Promise.all(
        Array.from({ length: DEFAULT_RATE_LIMIT.maxAttempts }, () =>
            recordFailedAttempt(supabase as any, "recep-1", "receptionist", CLINIC_A)
        )
    );

    assertEquals(rows(supabase).length, 1, "concurrent creates made a second row");
    assertEquals(
        rows(supabase)[0].failed_attempts,
        DEFAULT_RATE_LIMIT.maxAttempts,
        "an attempt was lost, so the lockout can be outrun"
    );
    assert(locked.some(Boolean), "nothing reported the lockout");
});
