import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { listAdminUsers, getAdminLimit } from "./actions";
import { AdminUsersList } from "./AdminUsersList";
import { CreateAdminForm } from "./CreateAdminForm";

/**
 * Admin Users Management Page
 *
 * Only ADMIN role can access this page to manage other admins.
 * Features:
 * - List all active admins
 * - Create new admin users
 * - Reset passwords
 * - Change roles
 * - Deactivate users
 */

export default async function AdminUsersPage() {
  const session = await getAdminSession();

  // Only ADMIN role can manage admins
  if (!session || session.role !== "ADMIN") {
    redirect("/admin/login");
  }

  let adminUsers = [];
  let error: string | null = null;

  try {
    adminUsers = await listAdminUsers();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load admin users";
  }

  const maxAdmins = getAdminLimit();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Users</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage admin and receptionist accounts ({adminUsers.length} / {maxAdmins})
        </p>
      </div>

      {/* Create new admin */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Create New Admin User</h2>
        <CreateAdminForm maxAdmins={maxAdmins} currentCount={adminUsers.length} />
      </div>

      {/* Admin users list */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Active Admins ({adminUsers.length})
        </h2>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {adminUsers.length === 0 ? (
          <p className="text-sm text-slate-500">No admin users found</p>
        ) : (
          <AdminUsersList adminUsers={adminUsers} currentUserEmail={session.email} />
        )}
      </div>

      {/* Info section */}
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-900 text-sm mb-2">📌 Info</h3>
        <ul className="text-xs text-slate-600 space-y-1">
          <li>• <strong>ADMIN:</strong> Full access to all features including admin management</li>
          <li>• <strong>RECEPTIONIST:</strong> Limited access (appointments, patients, analytics)</li>
          <li>• Passwords are hashed with scrypt — never stored in plaintext</li>
          <li>• You cannot deactivate the last active admin</li>
          <li>• Maximum {maxAdmins} admins per clinic</li>
        </ul>
      </div>
    </div>
  );
}
