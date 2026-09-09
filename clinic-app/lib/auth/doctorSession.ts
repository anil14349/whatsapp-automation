import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";

/**
 * Signed, stateless doctor session cookie for the web portal — same
 * hand-rolled HMAC/base64url pattern as lib/auth/session.ts (the admin
 * session), kept as a separate cookie/payload shape so the two can
 * coexist in one browser (e.g. a receptionist who is also testing the
 * doctor portal). Format: "<base64url-json>.<hmac-hex>".
 *
 * Reuses ADMIN_SESSION_SECRET for the HMAC key rather than introducing
 * a new env var: doctors are clinic-internal staff, exactly like
 * admin_users, not patients — there is no lower-trust audience here
 * that would need a separate secret boundary. The cookie name
 * ("doctor_session" vs "admin_session") and payload shape
 * (DoctorSessionPayload vs AdminSessionPayload) already differ enough
 * that a token signed/decoded for one type can never be mistaken for
 * the other, even though both are signed with the same key.
 */

const COOKIE_NAME = "doctor_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface DoctorSessionPayload {
  doctorId: string;
  email: string;
  expiresAt: number;
}

function sign(payload: string): string {
  const env = getServerEnv();
  return createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("hex");
}

function encode(payload: DoctorSessionPayload): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${json}.${sign(json)}`;
}

function decode(token: string): DoctorSessionPayload | null {
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
    return payload as DoctorSessionPayload;
  } catch {
    return null;
  }
}

export async function createDoctorSession(doctor: {
  id: string;
  email: string;
}): Promise<void> {
  const payload: DoctorSessionPayload = {
    doctorId: doctor.id,
    email: doctor.email,
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

export async function getDoctorSession(): Promise<DoctorSessionPayload | null> {
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

export async function clearDoctorSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
