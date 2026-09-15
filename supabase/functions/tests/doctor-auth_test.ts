/**
 * Doctor portal PIN authentication.
 *
 * A doctor's own bcrypt pin_hash is the only credential unless the shared env
 * PIN is explicitly enabled. Getting that precedence backwards would let one
 * leaked shared PIN open every account.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B, DOCTOR_PHONE } from "./helpers/fixtures.ts";
import { hashPassword } from "../shared/bcrypt-password.ts";

Deno.env.set("DOCTOR_PORTAL_PIN", "123456");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", "true");

const { verifyDoctorPin, isAccountLocked, getRemainingAttempts, clearAuthCache } =
    await import("../shared/doctor-auth.ts");

// Attempt counters are cached per phone+clinic, so tests use distinct numbers.
let counter = 0;
function uniquePhone(): string {
    counter += 1;
    return `9198765${String(counter).padStart(5, "0")}`;
}

Deno.test("a doctor without a hash can log in with the shared PIN when it is enabled", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "123456")).success, true);
});

Deno.test("a doctor with their own hash must use it", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;
    supabase.store.doctors[0].pin_hash = await hashPassword("4827");

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "4827")).success, true);
});

Deno.test("the shared PIN stops working once a personal PIN is set", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;
    supabase.store.doctors[0].pin_hash = await hashPassword("4827");

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "123456")).success, false);
});

Deno.test("a wrong PIN is rejected", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "000000")).success, false);
});

Deno.test("one doctor's PIN does not unlock another clinic's portal", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;
    supabase.store.doctors[0].pin_hash = await hashPassword("4827");

    // Same number, wrong tenant: there is no such doctor at clinic B, so the
    // personal hash must not be consulted and the env PIN must not apply.
    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_B, "4827")).success, false);
});

Deno.test("an inactive doctor cannot authenticate with their hash", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;
    supabase.store.doctors[0].is_active = false;
    supabase.store.doctors[0].pin_hash = await hashPassword("4827");

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "4827")).success, false);
});

Deno.test("repeated failures lock the account", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    assertEquals(await isAccountLocked(supabase, phone, CLINIC_A), false);

    for (let i = 0; i < 3; i++) {
        await verifyDoctorPin(supabase, phone, CLINIC_A, "999999");
    }

    assertEquals(await isAccountLocked(supabase, phone, CLINIC_A), true);
});

Deno.test("remaining attempts count down and reset on success", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    const before = await getRemainingAttempts(supabase, phone, CLINIC_A);

    await verifyDoctorPin(supabase, phone, CLINIC_A, "999999");

    assertEquals(await getRemainingAttempts(supabase, phone, CLINIC_A), before - 1);

    // A correct PIN must wipe the counter, otherwise a doctor stays one
    // mistake away from lockout forever.
    await verifyDoctorPin(supabase, phone, CLINIC_A, "123456");

    assertEquals(await getRemainingAttempts(supabase, phone, CLINIC_A), before);
});

Deno.test("a lockout at one clinic does not lock the other", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    for (let i = 0; i < 3; i++) {
        await verifyDoctorPin(supabase, phone, CLINIC_A, "999999");
    }

    assertEquals(await isAccountLocked(supabase, phone, CLINIC_A), true);
    assertEquals(await isAccountLocked(supabase, phone, CLINIC_B), false);

    clearAuthCache();
});

Deno.test("the shared PIN is refused unless explicitly enabled", async () => {
    Deno.env.delete("ALLOW_SHARED_DOCTOR_PIN");

    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "123456")).success, false);

    Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", "true");
});

Deno.test("a personal PIN still works with the shared PIN disabled", async () => {
    Deno.env.delete("ALLOW_SHARED_DOCTOR_PIN");

    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;
    supabase.store.doctors[0].pin_hash = await hashPassword("419628");

    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "419628")).success, true);

    Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", "true");
});

Deno.test("anything other than the literal string true keeps it disabled", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    for (const value of ["1", "yes", "TRUE", ""]) {
        Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", value);
        clearAuthCache();

        assertEquals(
            (await verifyDoctorPin(supabase, phone, CLINIC_A, "123456")).success,
            false,
            `ALLOW_SHARED_DOCTOR_PIN="${value}" should not enable the shared PIN`
        );
    }

    Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", "true");
    clearAuthCache();
});

Deno.test("failed attempts survive the in-memory cache being lost", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    // Each inbound WhatsApp message may land on a fresh edge isolate, so the
    // counter has to come from the database, not process memory.
    for (let i = 0; i < 3; i++) {
        await verifyDoctorPin(supabase, phone, CLINIC_A, "999999");
        clearAuthCache();
    }

    assertEquals(await isAccountLocked(supabase, phone, CLINIC_A), true);

    clearAuthCache();
    assertEquals(
        await isAccountLocked(supabase, phone, CLINIC_A),
        true,
        "lockout must still hold after the cache is dropped"
    );

    clearAuthCache();
});

Deno.test("the attempt count is written to login_rate_limits", async () => {
    const supabase = fakeSupabase(seed());
    const phone = uniquePhone();
    supabase.store.doctors[0].phone = phone;

    await verifyDoctorPin(supabase, phone, CLINIC_A, "999999");

    const rows = supabase.rows("login_rate_limits");

    assertEquals(rows.length, 1);
    assertEquals(rows[0].failed_attempts, 1);
    assertEquals(rows[0].user_type, "doctor");

    clearAuthCache();
});
