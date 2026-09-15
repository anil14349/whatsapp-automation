/**
 * PIN rules.
 *
 * The WhatsApp change-PIN flow and the portal reset API must agree: a PIN
 * accepted on one and rejected by the other locks a doctor out of the portal.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { validatePinStrength, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from "../shared/bcrypt-password.ts";

Deno.test("PINs of four to six digits are accepted", () => {
    for (const pin of ["4827", "58316", "417293"]) {
        assertEquals(validatePinStrength(pin).valid, true, `${pin} should be accepted`);
    }
});

Deno.test("PINs outside the length range are rejected", () => {
    assertEquals(validatePinStrength("123").valid, false);
    assertEquals(validatePinStrength("4827193").valid, false);
    assertEquals(validatePinStrength("").valid, false);
});

Deno.test("the declared range matches what is enforced", () => {
    assertEquals(PIN_MIN_LENGTH, 4);
    assertEquals(PIN_MAX_LENGTH, 6);
    assertEquals(validatePinStrength("4".repeat(PIN_MIN_LENGTH - 1)).valid, false);
    assertEquals(validatePinStrength("1".repeat(PIN_MAX_LENGTH + 1)).valid, false);
});

Deno.test("non-digits are rejected", () => {
    assertEquals(validatePinStrength("abcd").valid, false);
    assertEquals(validatePinStrength("12a4").valid, false);
    assertEquals(validatePinStrength("12 4").valid, false);
});

Deno.test("ascending and descending runs are rejected at any length", () => {
    for (const pin of ["1234", "4321", "45678", "987654", "0123"]) {
        assertEquals(validatePinStrength(pin).valid, false, `${pin} should be rejected`);
    }
});

Deno.test("repeated digits are rejected at any length", () => {
    for (const pin of ["1111", "00000", "888888"]) {
        assertEquals(validatePinStrength(pin).valid, false, `${pin} should be rejected`);
    }
});

Deno.test("a six digit PIN that is not a run is accepted", () => {
    // Regression: the old rule rejected anything longer than four digits, so a
    // PIN set over WhatsApp could not be reset through the API.
    assertEquals(validatePinStrength("123456").valid, false);
    assertEquals(validatePinStrength("419628").valid, true);
});

Deno.test("errors explain why a PIN was rejected", () => {
    const result = validatePinStrength("1234");

    assertEquals(result.valid, false);
    assertEquals(result.errors.length > 0, true);
});
