"use client";

import { useState } from "react";
import { changeAdminRoleAction, type AdminUserFormState } from "./actions";
import type { AdminRole } from "@/lib/supabase/database.types";
import { BrandedButton, BrandedSelect } from "@/app/admin/(dashboard)/components/branded";

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
}

export function ChangeRoleModal({
  adminId,
  adminUser,
  onClose
}: {
  adminId: string;
  adminUser: AdminUser;
  onClose: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<AdminRole>(adminUser.role);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChangeRole = async () => {
    setLoading(true);
    try {
      const result = await changeAdminRoleAction(adminId, selectedRole);
      if (result.success) {
        setMessage({ type: "success", text: "Role updated successfully" });
        setTimeout(() => onClose(), 1000);
      } else {
        setMessage({ type: "error", text: result.error || "Failed to change role" });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to change role"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Change Role</h2>
        <p className="text-sm text-slate-600 mb-4">{adminUser.full_name} ({adminUser.email})</p>

        <div className="space-y-4">
          <BrandedSelect
            label="New Role *"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as AdminRole)}
            options={[
              { value: "RECEPTIONIST", label: "Receptionist (Limited access - appointments, patients, analytics)" },
              { value: "ADMIN", label: "Admin (Full access - can manage admins and settings)" }
            ]}
          />

          {message && (
            <div
              className={`rounded-md p-3 text-sm ${
                message.type === "success"
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {message.type === "success" ? "✅ " : "❌ "}
              {message.text}
            </div>
          )}

          <div className="flex gap-3">
            <BrandedButton
              onClick={handleChangeRole}
              disabled={loading || selectedRole === adminUser.role}
              variant="primary"
            >
              {loading ? "Updating…" : "Update Role"}
            </BrandedButton>
            <BrandedButton
              onClick={onClose}
              variant="secondary"
            >
              Cancel
            </BrandedButton>
          </div>
        </div>
      </div>
    </div>
  );
}
