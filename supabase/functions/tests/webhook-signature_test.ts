/**
 * Proving an inbound webhook came from Meta.
 *
 * The webhook was gated by a `?token=` in the query string and nothing else,
 * so anyone holding that token could post a message as any phone number into a
 * chosen clinic. That was demonstrated, not theorised: a whole booking
 * conversation was driven through the live endpoint as a phone number that
 * belonged to nobody.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { isSignatureValid } from "../shared/webhook-signature.ts";

const SECRET = "meta-app-secret";
const BODY = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });

async function sign(body: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));

    return "sha256=" + Array.from(new Uint8Array(mac))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

Deno.test("a correctly signed body is accepted", async () => {
    const header = await sign(BODY, SECRET);

    assertEquals(await isSignatureValid(BODY, header, SECRET), true);
});

Deno.test("a body changed after signing is refused", async () => {
    const header = await sign(BODY, SECRET);
    const tampered = BODY.replace("messages", "mess@ges");

    assertEquals(await isSignatureValid(tampered, header, SECRET), false);
});

Deno.test("a signature from a different secret is refused", async () => {
    const header = await sign(BODY, "someone-elses-secret");

    assertEquals(await isSignatureValid(BODY, header, SECRET), false);
});

Deno.test("a missing header is refused rather than skipped", async () => {
    assertEquals(await isSignatureValid(BODY, null, SECRET), false);
});

Deno.test("a header without the sha256 prefix is refused", async () => {
    const header = (await sign(BODY, SECRET)).replace("sha256=", "");

    assertEquals(await isSignatureValid(BODY, header, SECRET), false);
});

Deno.test("an empty secret refuses rather than throwing on the zero-length key", async () => {
    const header = await sign(BODY, SECRET);

    assertEquals(await isSignatureValid(BODY, header, ""), false);
});

Deno.test("the header is accepted in either case", async () => {
    const header = (await sign(BODY, SECRET)).toUpperCase();

    assertEquals(await isSignatureValid(BODY, header, SECRET), true);
});

Deno.test("re-serialised JSON does not verify, which is why the raw body is kept", async () => {
    const header = await sign(BODY, SECRET);

    // What the code did before: parse, then work from the re-serialised form.
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);

    assertEquals(await isSignatureValid(reserialised, header, SECRET), false);
});
