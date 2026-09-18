/**
 * Server-side client for the Supabase edge functions.
 *
 * Every call is proxied through Next route handlers rather than made from the
 * browser. The portal JWT therefore lives in an httpOnly cookie that scripts
 * cannot read, the anon key is never relied on for authorisation, and the
 * browser never talks to Supabase cross-origin so CORS does not apply.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "portal_session";

export type PortalRole = "DOCTOR" | "RECEPTIONIST" | "ADMIN" | "CLINIC_OWNER";

export interface PortalSession {
    token: string;
    role: PortalRole;
    name: string;
    clinicId?: string;
}

function functionsBase(): string {
    const url = process.env.SUPABASE_URL;

    if (!url) {
        throw new Error("SUPABASE_URL is not configured");
    }

    return `${url.replace(/\/$/, "")}/functions/v1`;
}

function anonKey(): string {
    const key = process.env.SUPABASE_ANON_KEY;

    if (!key) {
        throw new Error("SUPABASE_ANON_KEY is not configured");
    }

    return key;
}

export interface PortalResponse<T = any> {
    ok: boolean;
    status: number;
    data: T;
}

/**
 * Call an edge function, attaching the caller's portal token when present.
 */
export async function callPortal<T = any>(
    path: string,
    options: { method?: string; body?: unknown; token?: string } = {}
): Promise<PortalResponse<T>> {
    const headers: Record<string, string> = {
        apikey: anonKey(),
        Authorization: `Bearer ${anonKey()}`
    };

    if (options.token) {
        headers["X-Portal-Token"] = options.token;
    }

    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${functionsBase()}/${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store"
    });

    const text = await response.text();

    let data: any;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { error: text };
    }

    return { ok: response.ok, status: response.status, data };
}

/**
 * The cookie is signed, so what it claims can be trusted.
 *
 * It used to be plain base64: anyone could rewrite `role` to CLINIC_OWNER and
 * the header would greet them as one, with the manager-only links on show. No
 * data followed, because every call carries the portal JWT that the edge
 * functions verify - but a portal that displays a role it has not checked is
 * one refactor away from trusting it.
 */
function sessionSecret(): string {
    const secret = process.env.PORTAL_SESSION_SECRET;

    if (!secret) {
        throw new Error("PORTAL_SESSION_SECRET is not configured");
    }

    return secret;
}

function sign(payload: string): string {
    return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export async function readSession(): Promise<PortalSession | null> {
    // Next 15 resolves cookies asynchronously.
    const raw = (await cookies()).get(SESSION_COOKIE)?.value;

    if (!raw) {
        return null;
    }

    const dot = raw.lastIndexOf(".");

    // No signature at all: either a cookie from before signing, or a forgery.
    if (dot < 1) {
        return null;
    }

    const payload = raw.slice(0, dot);
    const provided = Buffer.from(raw.slice(dot + 1), "base64url");

    try {
        const expected = Buffer.from(sign(payload), "base64url");

        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
            return null;
        }

        return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PortalSession;
    } catch {
        return null;
    }
}

export function serialiseSession(session: PortalSession): string {
    const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");

    return `${payload}.${sign(payload)}`;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/** Calls made on behalf of the signed-in user. */
export async function callAsUser<T = any>(
    path: string,
    options: { method?: string; body?: unknown } = {}
): Promise<PortalResponse<T>> {
    const session = await readSession();

    if (!session) {
        return { ok: false, status: 401, data: { error: "Not signed in" } as T };
    }

    return callPortal<T>(path, { ...options, token: session.token });
}

/**
 * Forward a file to an edge function.
 *
 * Separate from callPortal because Content-Type must be left unset: fetch adds
 * it along with the multipart boundary, and setting it by hand produces a body
 * the other end cannot parse.
 */
export async function uploadAsUser<T = any>(
    path: string,
    form: FormData
): Promise<PortalResponse<T>> {
    const session = await readSession();

    if (!session) {
        return { ok: false, status: 401, data: { error: "Not signed in" } as T };
    }

    const response = await fetch(`${functionsBase()}/${path}`, {
        method: "POST",
        headers: {
            apikey: anonKey(),
            Authorization: `Bearer ${anonKey()}`,
            "X-Portal-Token": session.token
        },
        body: form,
        cache: "no-store"
    });

    const text = await response.text();

    let data: any;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { error: text };
    }

    return { ok: response.ok, status: response.status, data };
}
