/**
 * Regression tests for password hashing.
 *
 * The async bcrypt API spawns a Web Worker, which the Supabase edge runtime
 * does not support, so hashing threw and every PIN write failed silently.
 * These tests exercise the same path the edge functions use.
 */

import { assert, assertEquals, assertNotEquals } from "std/testing/asserts.ts";
import {
    hashPassword,
    verifyPassword,
    validatePinStrength,
    validatePasswordStrength
} from "../shared/bcrypt-password.ts";

Deno.test("hashing produces a bcrypt hash rather than throwing", async () => {
    const hash = await hashPassword("4827");

    assert(/^\$2[aby]\$/.test(hash), `expected a bcrypt hash, got: ${hash}`);
});

Deno.test("a hashed PIN verifies against the original", async () => {
    const hash = await hashPassword("4827");

    assertEquals(await verifyPassword("4827", hash), true);
});

Deno.test("a different PIN does not verify", async () => {
    const hash = await hashPassword("4827");

    assertEquals(await verifyPassword("1234", hash), false);
});

Deno.test("the same PIN hashes differently each time (salted)", async () => {
    const a = await hashPassword("4827");
    const b = await hashPassword("4827");

    assertNotEquals(a, b);
    assertEquals(await verifyPassword("4827", b), true);
});

Deno.test("verification fails safely on empty or malformed input", async () => {
    const hash = await hashPassword("4827");

    assertEquals(await verifyPassword("", hash), false);
    assertEquals(await verifyPassword("4827", ""), false);
    assertEquals(await verifyPassword("4827", "not-a-hash"), false);
});

Deno.test("empty passwords are refused", async () => {
    let threw = false;

    try {
        await hashPassword("");
    } catch {
        threw = true;
    }

    assert(threw, "expected hashing an empty password to throw");
});

Deno.test("PIN strength rejects sequences and repeats", () => {
    assertEquals(validatePinStrength("1234").valid, false);
    assertEquals(validatePinStrength("1111").valid, false);
    assertEquals(validatePinStrength("abcd").valid, false);
    assertEquals(validatePinStrength("4827").valid, true);
});

Deno.test("password strength requires mixed characters", () => {
    assertEquals(validatePasswordStrength("short").valid, false);
    assertEquals(validatePasswordStrength("alllowercase123!").valid, false);
    assertEquals(validatePasswordStrength("Str0ng!Passw0rd").valid, true);
});
