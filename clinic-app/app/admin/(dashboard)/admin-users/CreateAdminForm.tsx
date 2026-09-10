"use client";

import { useRef, useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createAdminUserAction, type AdminUserFormState } from "./actions";
import { BrandedButton, BrandedInput, BrandedSelect } from "@/app/admin/(dashboard)/components/branded";

const initialState: AdminUserFormState = {};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <BrandedButton
      type="submit"
      disabled={pending || disabled}
      variant="primary"
    >
      {pending ? "Creating…" : "Create Admin User"}
    </BrandedButton>
  );
}

export function CreateAdminForm({
  maxAdmins,
  currentCount
}: {
  maxAdmins: number;
  currentCount: number;
}) {
  const [state, formAction] = useFormState(createAdminUserAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const isFull = currentCount >= maxAdmins;

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 max-w-md">
      <BrandedInput
        label="Full Name *"
        type="text"
        name="full_name"
        required
      />

      <BrandedInput
        label="Email *"
        type="email"
        name="email"
        required
      />

      <BrandedInput
        label="Password *"
        type="password"
        name="password"
        required
        minLength={8}
        placeholder="Min 8 characters"
      />

      <BrandedInput
        label="Confirm Password *"
        type="password"
        name="confirmPassword"
        required
        minLength={8}
      />

      <BrandedSelect
        label="Role *"
        name="role"
        defaultValue="RECEPTIONIST"
        options={[
          { value: "RECEPTIONIST", label: "Receptionist (limited access)" },
          { value: "ADMIN", label: "Admin (full access)" }
        ]}
      />

      <div className="flex items-center gap-3">
        <SubmitButton disabled={isFull} />
        {isFull && (
          <span className="text-xs text-red-600">
            Maximum {maxAdmins} admins reached
          </span>
        )}
      </div>

      {state.success && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          ✅ Admin user created successfully
        </div>
      )}

      {state.error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{state.error}</div>
      )}
    </form>
  );
}
