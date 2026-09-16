/**
 * Sign in as a doctor, receptionist or clinic owner.
 *
 * The three roles have separate login endpoints and different credential
 * fields, so the route normalises them into one session cookie.
 */

import { NextResponse } from "next/server";
import { callPortal, serialiseSession, SESSION_COOKIE_NAME, type PortalRole } from "@/lib/portal";

interface LoginBody {
    role: "doctor" | "receptionist" | "owner";
    email: string;
    secret: string;
}

const ENDPOINTS = {
    doctor: "doctors-auth-login",
    receptionist: "receptionists-auth-login",
    owner: "admins-auth-login"
} as const;

/**
 * The clinic this portal belongs to.
 *
 * Deliberately read here rather than sent up from the browser. It used to be a
 * form field seeded from a NEXT_PUBLIC_ variable, which meant it shipped to the
 * page and anyone could type a different clinic's id into it. A deployment
 * serves one clinic, so the server is the only thing that needs to know which.
 */
function configuredClinicId(): string {
    return (
        process.env.DEFAULT_CLINIC_ID ??
        process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID ??
        ""
    ).trim();
}

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as LoginBody | null;

    if (!body?.role || !body.email || !body.secret || !ENDPOINTS[body.role]) {
        return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    const clinicId = configuredClinicId();

    if (body.role !== "owner" && !clinicId) {
        // A missing setting is nothing the person signing in can fix, so say so
        // rather than blaming their details.
        return NextResponse.json(
            { error: "This portal has no clinic configured. Set DEFAULT_CLINIC_ID." },
            { status: 500 }
        );
    }

    const payload =
        body.role === "doctor"
            ? { email: body.email, pin: body.secret, clinicId }
            : body.role === "receptionist"
                ? { email: body.email, password: body.secret, clinicId }
                : { email: body.email, password: body.secret, clinicId: clinicId || undefined };

    const result = await callPortal(ENDPOINTS[body.role], { method: "POST", body: payload });

    if (!result.ok || !result.data?.token) {
        // Pass the upstream message through unchanged; it is already worded to
        // avoid revealing whether an account exists.
        return NextResponse.json(
            { error: result.data?.error ?? "Sign in failed" },
            { status: result.status === 200 ? 400 : result.status }
        );
    }

    const profile = result.data.doctor ?? result.data.receptionist ?? result.data.admin ?? {};

    const session = {
        token: result.data.token as string,
        role: (profile.role ?? (body.role === "doctor" ? "DOCTOR" : "RECEPTIONIST")) as PortalRole,
        name: profile.name ?? body.email,
        clinicId: profile.clinicId ?? profile.clinic?.id ?? clinicId
    };

    const response = NextResponse.json({ ok: true, role: session.role });

    response.cookies.set(SESSION_COOKIE_NAME, serialiseSession(session), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 12
    });

    return response;
}
