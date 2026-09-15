/**
 * CORS behaviour for the portal API.
 *
 * The clinic-app sends the Supabase anon key in Authorization and the portal
 * JWT in X-Portal-Token, so both must survive preflight.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { withCors, corsHeaders } from "../shared/cors.ts";

function request(method: string, origin?: string): Request {
    return new Request("https://example.com/doctors-auth-me", {
        method,
        headers: origin ? { Origin: origin } : {}
    });
}

const ok = withCors(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));

Deno.test("a preflight is answered without reaching the handler", async () => {
    let handlerRan = false;

    const wrapped = withCors(() => {
        handlerRan = true;
        return new Response("should not happen");
    });

    const response = await wrapped(request("OPTIONS", "http://localhost:3000"));

    assertEquals(response.status, 204);
    assertEquals(handlerRan, false);
});

Deno.test("preflight advertises the portal token header", async () => {
    const response = await ok(request("OPTIONS", "http://localhost:3000"));
    const allowed = response.headers.get("Access-Control-Allow-Headers") ?? "";

    assertEquals(allowed.includes("x-portal-token"), true);
    assertEquals(allowed.includes("authorization"), true);
    assertEquals(allowed.includes("apikey"), true);
});

Deno.test("real responses carry CORS headers and the original body", async () => {
    const response = await ok(request("GET", "http://localhost:3000"));

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(await response.json(), { ok: true });
});

Deno.test("error statuses are preserved through the wrapper", async () => {
    const wrapped = withCors(() => new Response("nope", { status: 401 }));

    const response = await wrapped(request("GET", "http://localhost:3000"));

    assertEquals(response.status, 401);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("with no allow-list configured any origin is permitted", () => {
    Deno.env.delete("ALLOWED_ORIGINS");

    const headers = corsHeaders(request("GET", "https://anything.example"));

    assertEquals(headers["Access-Control-Allow-Origin"], "*");
});

Deno.test("an allow-listed origin is echoed back", () => {
    Deno.env.set("ALLOWED_ORIGINS", "https://portal.example,https://admin.example");

    const headers = corsHeaders(request("GET", "https://admin.example"));

    assertEquals(headers["Access-Control-Allow-Origin"], "https://admin.example");

    Deno.env.delete("ALLOWED_ORIGINS");
});

Deno.test("an unknown origin gets no allow header", () => {
    Deno.env.set("ALLOWED_ORIGINS", "https://portal.example");

    const headers = corsHeaders(request("GET", "https://evil.example"));

    assertEquals(headers["Access-Control-Allow-Origin"], undefined);

    Deno.env.delete("ALLOWED_ORIGINS");
});

Deno.test("responses vary on Origin so caches cannot leak across origins", () => {
    Deno.env.set("ALLOWED_ORIGINS", "https://portal.example");

    assertEquals(corsHeaders(request("GET", "https://portal.example")).Vary, "Origin");

    Deno.env.delete("ALLOWED_ORIGINS");
});
