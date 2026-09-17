/**
 * Storing a clinic's logo.
 *
 * Until now the logo was a URL the clinic had to host somewhere themselves,
 * which means most clinics have no logo: the people who run a clinic do not
 * generally have somewhere to put a PNG. This takes the file instead.
 *
 * The bucket is public, unlike patient documents. A logo is on every page of
 * the portal, so a signed URL would expire mid-session, and a logo is not
 * confidential — it is the one thing a clinic most wants seen.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

export const LOGO_BUCKET = "clinic-logos";

/** A header mark renders at 32px. Anything near this is already generous. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * SVG is deliberately absent. A browser opening an SVG directly executes any
 * script inside it, on the storage origin, and the bucket is public — so an
 * uploaded logo would be a stored XSS anyone could be linked to.
 */
export const ALLOWED_LOGO_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
};

export interface LogoResult {
    ok: boolean;
    url?: string;
    path?: string;
    error?: string;
}

/**
 * Built from the clinic and a fresh id, never from the uploaded name, so a
 * crafted filename cannot climb into another clinic's folder. The random part
 * also defeats caching of a previous logo at the same address.
 */
export function logoKey(clinicId: string, contentType: string): string {
    const extension = ALLOWED_LOGO_TYPES[contentType] ?? "png";

    return `${clinicId}/${crypto.randomUUID()}.${extension}`;
}

export async function storeLogo(
    supabase: SupabaseClient,
    clinicId: string,
    file: { bytes: ArrayBuffer; contentType: string }
): Promise<LogoResult> {
    if (!(file.contentType in ALLOWED_LOGO_TYPES)) {
        return { ok: false, error: "A logo must be a PNG, JPEG or WebP image" };
    }

    if (file.bytes.byteLength > MAX_LOGO_BYTES) {
        return { ok: false, error: "That image is larger than 2 MB" };
    }

    const path = logoKey(clinicId, file.contentType);

    const upload = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file.bytes, { contentType: file.contentType, upsert: false });

    if (upload.error) {
        debug("clinicLogo", "Upload failed", { clinicId, error: upload.error.message });
        return { ok: false, error: `Could not store the logo: ${upload.error.message}` };
    }

    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

    if (!data?.publicUrl) {
        await supabase.storage.from(LOGO_BUCKET).remove([path]);
        return { ok: false, error: "Could not build a public address for the logo" };
    }

    return { ok: true, url: data.publicUrl, path };
}

/**
 * Remove a logo this clinic previously uploaded.
 *
 * Only ours: a clinic that pasted a URL to a logo hosted elsewhere must not
 * have us try to delete it, and the path check keeps one clinic from deleting
 * another's. Failure is logged and swallowed — an orphaned object is not worth
 * refusing the new logo over.
 */
export async function removeStoredLogo(
    supabase: SupabaseClient,
    clinicId: string,
    previousUrl: string | null | undefined
): Promise<void> {
    const path = storedLogoPath(clinicId, previousUrl);

    if (!path) {
        return;
    }

    const { error } = await supabase.storage.from(LOGO_BUCKET).remove([path]);

    if (error) {
        debug("clinicLogo", "Could not remove the previous logo", {
            clinicId,
            error: error.message
        });
    }
}

/** The object key inside our bucket, or null if this URL is not ours. */
export function storedLogoPath(
    clinicId: string,
    url: string | null | undefined
): string | null {
    if (!url) {
        return null;
    }

    const marker = `/${LOGO_BUCKET}/`;
    const at = url.indexOf(marker);

    if (at === -1) {
        return null;
    }

    const path = url.slice(at + marker.length).split("?")[0];

    return path.startsWith(`${clinicId}/`) ? path : null;
}
