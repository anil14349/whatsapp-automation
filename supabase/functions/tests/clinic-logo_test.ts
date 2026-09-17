/**
 * Storing a clinic's logo.
 *
 * The bucket is public, so the object key is the only thing keeping one
 * clinic's uploads out of another's folder — and the key must never be built
 * from anything the uploader sent.
 */

import { assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { CLINIC_A, CLINIC_B } from "./helpers/fixtures.ts";
import {
    ALLOWED_LOGO_TYPES,
    LOGO_BUCKET,
    MAX_LOGO_BYTES,
    logoKey,
    storedLogoPath,
    storeLogo
} from "../shared/clinic-logo.ts";

const PNG = "image/png";

function bytes(size: number): ArrayBuffer {
    return new Uint8Array(size).buffer;
}

Deno.test("the key is under the clinic's own folder", () => {
    const key = logoKey(CLINIC_A, PNG);

    assertStringIncludes(key, `${CLINIC_A}/`);
    assertEquals(key.endsWith(".png"), true);
});

Deno.test("two uploads never collide, so a replacement is not cached as the old one", () => {
    assertEquals(logoKey(CLINIC_A, PNG) === logoKey(CLINIC_A, PNG), false);
});

Deno.test("SVG is refused, because a public bucket would make it stored XSS", async () => {
    assertEquals("image/svg+xml" in ALLOWED_LOGO_TYPES, false);

    const result = await storeLogo(fakeSupabase({}) as any, CLINIC_A, {
        bytes: bytes(10),
        contentType: "image/svg+xml"
    });

    assertEquals(result.ok, false);
});

Deno.test("an oversized image is refused before it is stored", async () => {
    const supabase = fakeSupabase({});

    const result = await storeLogo(supabase as any, CLINIC_A, {
        bytes: bytes(MAX_LOGO_BYTES + 1),
        contentType: PNG
    });

    assertEquals(result.ok, false);
    assertEquals(supabase.storage.objects.length, 0);
});

Deno.test("a stored logo lands in the logo bucket and gets an address", async () => {
    const supabase = fakeSupabase({});

    const result = await storeLogo(supabase as any, CLINIC_A, {
        bytes: bytes(2048),
        contentType: PNG
    });

    assertEquals(result.ok, true);
    assertEquals(supabase.storage.objects[0].bucket, LOGO_BUCKET);
    assertStringIncludes(result.url ?? "", LOGO_BUCKET);
});

Deno.test("a url we did not store is not ours to delete", () => {
    assertEquals(storedLogoPath(CLINIC_A, "https://example.com/their-own-logo.png"), null);
    assertEquals(storedLogoPath(CLINIC_A, null), null);
});

Deno.test("one clinic cannot delete another's logo through the path", () => {
    const theirs = `https://x.supabase.co/storage/v1/object/public/${LOGO_BUCKET}/${CLINIC_B}/abc.png`;

    assertEquals(storedLogoPath(CLINIC_A, theirs), null);
    assertEquals(storedLogoPath(CLINIC_B, theirs), `${CLINIC_B}/abc.png`);
});

Deno.test("a query string on the address does not defeat the path match", () => {
    const own = `https://x.supabase.co/storage/v1/object/public/${LOGO_BUCKET}/${CLINIC_A}/abc.png?v=2`;

    assertEquals(storedLogoPath(CLINIC_A, own), `${CLINIC_A}/abc.png`);
});
