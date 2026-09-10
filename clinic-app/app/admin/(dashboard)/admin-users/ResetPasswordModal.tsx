"use client";

import { useRef, useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { resetAdminPasswordAction, type AdminUserFormState } from "./actions";
import { BrandedButton, BrandedInput } from "@/app/admin/(dashboard)/components/branded";

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <BrandedButton
      type="submit"
      disabled={pending}
      variant="primary"
    >
      {pending ? "Saving…" : "Reset Password"}
    </BrandedButton>
  );
}

export function ResetPasswordModal({
  adminId,
  adminUser,
  onClose
}: {
  adminId: string;
  adminUser: AdminUser;
  onClose: () => void;
}) {
  const initialState: AdminUserFormState = {};
  const boundAction = resetAdminPasswordAction.bind(null, adminId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      // Close modal after success
      setTimeout(() => onClose(), 1000);
    }
  }, [state.success, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Reset Password</h2>
        <p className="text-sm text-slate-600 mb-4">{adminUser.full_name} ({adminUser.email})</p>

        <form ref={formRef} action={formAction} className="space-y-4">
          <BrandedInput
            label="New Password *"
            type="password"
            name="password"
            required
            minLength={8}
            placeholder="Min 8 characters"
            autoFocus
          />

          <BrandedInput
            label="Confirm Password *"
            type="password"
            name="confirmPassword"
            required
            minLength={8}
          />

          {state.success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              ✅ Password updated successfully
            </div>
          )}

          {state.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{state.error}</div>
          )}

          <div className="flex gap-3">
            <SubmitButton />
            <BrandedButton
              type="button"
              onClick={onClose}
              variant="secondary"
            >
              Cancel
            </BrandedButton>
          </div>
        </form>
      </div>
    </div>
  );
}
