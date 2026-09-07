import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";
import type { AdminRole } from "@/lib/supabase/database.types";

/**
 * Signed, stateless admin session cookie — no session table, no
 * Supabase Auth (deliberately not used for the admin UI; see
 * clinic-app/README.md). Format: "<base64url-json>.<hmac-hex>", verified
 * with HMAC-SHA256 keyed by ADMIN_SESSION_SECRET before trusting the
 * payload. Not a JWT library dependency — this is the same idea (signed
 * claims), hand-rolled because the claim shape is tiny and fixed.
 */

const COOKIE_NAME = "admin_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface AdminSessionPayload {
  adminUserId: string;
  email: string;
  role: AdminRole;
  expiresAt: number;
}

function sign(payload: string): string {
  const env = getServerEnv();
  return createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("hex");
}

function encode(payload: AdminSessionPayload): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${json}.${sign(json)}`;
}

function decode(token: string): AdminSessionPayload | null {
  const [json, signature] = token.split(".");

  if (!json || !signature) {
    return null;
  }

  const expectedSignature = sign(json);

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
    return payload as AdminSessionPayload;
  } catch {
    return null;
  }
}

export async function createAdminSession(user: {
  id: string;
  email: string;
  role: AdminRole;
}): Promise<void> {
  const payload: AdminSessionPayload = {
    adminUserId: user.id,
    email: user.email,
    role: user.role,
    expiresAt: Date.now() + SESSION_DURATION_MS
  };

  const store = await cookies();

  store.set(COOKIE_NAME, encode(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000
  });
}

export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const payload = decode(token);

  if (!payload || payload.expiresAt < Date.now()) {
    return null;
  }

  return payload;
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
