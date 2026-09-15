/**
 * Regression tests for JWT handling.
 *
 * djwt v3 requires a CryptoKey. Passing the raw secret string threw
 * "Cannot read properties of undefined (reading 'name')" at runtime, which
 * meant no portal token could ever be issued. Type checking did not catch it.
 */

import { assert, assertEquals, assertNotEquals } from "std/testing/asserts.ts";

Deno.env.set("JWT_SECRET", "test-secret-that-is-at-least-32-characters-long");

const { createJwtToken, verifyJwtToken, validateRequest, extractTokenFromHeader } = await import(
    "../shared/jwt-auth.ts"
);

const payload = {
    userId: "doc-1",
    email: "doc@example.com",
    role: "DOCTOR" as const,
    clinicId: "clinic-1",
    doctorId: "doc-1"
};

Deno.test("issues a token that verifies back to the same claims", async () => {
    const token = await createJwtToken(payload, 1);

    assert(token.split(".").length === 3, "expected a three-part JWT");

    const decoded = await verifyJwtToken(token);

    assertEquals(decoded?.userId, "doc-1");
    assertEquals(decoded?.role, "DOCTOR");
    assertEquals(decoded?.clinicId, "clinic-1");
});

Deno.test("rejects a token signed with a different secret", async () => {
    const token = await createJwtToken(payload, 1);

    // Tamper with the signature rather than re-signing, which is what an
    // attacker without the secret can actually do.
    const [header, body] = token.split(".");
    const forged = `${header}.${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    assertEquals(await verifyJwtToken(forged), null);
});

Deno.test("rejects a token with an altered payload", async () => {
    const token = await createJwtToken(payload, 1);
    const [header, , signature] = token.split(".");

    const tamperedBody = btoa(
        JSON.stringify({ ...payload, role: "ADMIN" })
    ).replace(/=+$/, "");

    assertEquals(await verifyJwtToken(`${header}.${tamperedBody}.${signature}`), null);
});

Deno.test("rejects an expired token", async () => {
    const expired = await createJwtToken(payload, -1);

    assertEquals(await verifyJwtToken(expired), null);
});

Deno.test("reads the portal token from X-Portal-Token", async () => {
    const token = await createJwtToken(payload, 1);

    const req = new Request("https://example.com/doctors-auth-me", {
        headers: { "X-Portal-Token": token, Authorization: "Bearer some-supabase-anon-key" }
    });

    const decoded = await validateRequest(req);

    assertEquals(decoded?.userId, "doc-1");
});

Deno.test("falls back to the Authorization header when no portal header is sent", async () => {
    const token = await createJwtToken(payload, 1);

    const req = new Request("https://example.com/doctors-auth-me", {
        headers: { Authorization: `Bearer ${token}` }
    });

    assertEquals((await validateRequest(req))?.userId, "doc-1");
});

Deno.test("returns null when no token is present at all", async () => {
    const req = new Request("https://example.com/doctors-auth-me");

    assertEquals(await validateRequest(req), null);
});

Deno.test("extractTokenFromHeader ignores malformed headers", () => {
    assertEquals(extractTokenFromHeader("Bearer abc"), "abc");
    assertEquals(extractTokenFromHeader("abc"), null);
    assertEquals(extractTokenFromHeader(null), null);
    assertEquals(extractTokenFromHeader(""), null);
});

Deno.test("two tokens for different users do not collide", async () => {
    const a = await createJwtToken(payload, 1);
    const b = await createJwtToken({ ...payload, userId: "doc-2" }, 1);

    assertNotEquals(a, b);
    assertEquals((await verifyJwtToken(b))?.userId, "doc-2");
});
