import { redirect } from "next/navigation";
import type { AdminRole } from "@/lib/supabase/database.types";
import { getAdminSession, type AdminSessionPayload } from "./session";

/**
 * ADMIN vs RECEPTIONIST authorization. The `admin_users.role` column and
 * `AdminSessionPayload.role` have existed since stage 4 — this is the
 * first code that actually reads either to gate anything; see
 * clinic-app/README.md's "Admin/Receptionist roles" section for what
 * each role can do.
 *
 * Two entry points, because Server Components and Server Actions need to
 * fail differently:
 * - Pages/layouts use `requireAdminRole`, which redirects (there's a
 *   page to redirect *from*).
 * - Server Actions use `assertAdminRole`, which throws (a Server Action
 *   has no page of its own to redirect away from — the caller's
 *   existing error-message UI is what surfaces the rejection). This
 *   also closes a real gap: none of the admin Server Actions checked
 *   *any* session before this, valid or not — a Server Action is a
 *   directly callable endpoint independent of whichever page happens to
 *   render a button for it, so "the page is behind the layout's login
 *   check" was never actually sufficient on its own.
 */

export class UnauthorizedError extends Error {}

export async function requireAdminRole(allowedRoles: AdminRole[]): Promise<AdminSessionPayload> {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  if (!allowedRoles.includes(session.role)) {
    redirect("/admin");
  }

  return session;
}

export async function assertAdminRole(allowedRoles: AdminRole[]): Promise<AdminSessionPayload> {
  const session = await getAdminSession();

  // Fail closed: no session at all is rejected exactly like a session
  // with the wrong role, never treated as "not applicable, let it
  // through" — same reasoning already applied to
  // checkAppointmentOwnership in lib/appointments.ts.
  if (!session || !allowedRoles.includes(session.role)) {
    throw new UnauthorizedError("Not authorized to perform this action.");
  }

  return session;
}
