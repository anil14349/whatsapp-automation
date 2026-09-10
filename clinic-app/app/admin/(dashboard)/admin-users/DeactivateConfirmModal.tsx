"use client";

import { useState } from "react";
import { deactivateAdminAction, type AdminUserFormState } from "./actions";
import { BrandedButton } from "@/app/admin/(dashboard)/components/branded";

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
}

export function DeactivateConfirmModal({
  adminId,
  adminUser,
  onClose
}: {
  adminId: string;
  adminUser: AdminUser;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleDeactivate = async () => {
    setLoading(true);
    try {
      const result = await deactivateAdminAction(adminId);
      if (result.success) {
        setMessage({ type: "success", text: "Admin user deactivated" });
        setTimeout(() => onClose(), 1000);
      } else {
        setMessage({ type: "error", text: result.error || "Failed to deactivate user" });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to deactivate user"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-red-900 mb-2">⚠️ Deactivate Admin User</h2>
        <div className="space-y-3 mb-4">
          <p className="text-sm text-slate-600">
            You are about to deactivate: <strong>{adminUser.full_name}</strong> (
            {adminUser.email})
          </p>
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            <strong>Warning:</strong> This user will no longer be able to log in. Their data will
            remain intact.
          </div>
        </div>

        {message && (
          <div
            className={`rounded-md p-3 text-sm mb-4 ${
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
            onClick={handleDeactivate}
            disabled={loading}
            variant="danger"
          >
            {loading ? "Deactivating…" : "Yes, Deactivate"}
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
  );
}
