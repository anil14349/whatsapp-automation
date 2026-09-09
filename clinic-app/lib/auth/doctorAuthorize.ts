import { redirect } from "next/navigation";
import { getDoctorSession, type DoctorSessionPayload } from "./doctorSession";

/**
 * No role concept for the doctor portal — every doctor sees the same
 * portal, scoped to only their own data via session.doctorId. Two entry
 * points, same reasoning as lib/auth/authorize.ts:
 * - Pages/layouts use `requireDoctorSession`, which redirects (there's a
 *   page to redirect *from*).
 * - Server Actions use `assertDoctorSession`, which throws (a Server
 *   Action has no page of its own to redirect away from).
 */

export class UnauthorizedError extends Error {}

export async function requireDoctorSession(): Promise<DoctorSessionPayload> {
  const session = await getDoctorSession();

  if (!session) {
    redirect("/doctor/login");
  }

  return session;
}

export async function assertDoctorSession(): Promise<DoctorSessionPayload> {
  const session = await getDoctorSession();

  // Fail closed: no session at all is rejected, never treated as "not
  // applicable, let it through" — same reasoning as assertAdminRole.
  if (!session) {
    throw new UnauthorizedError("Not authorized to perform this action.");
  }

  return session;
}
