"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { resetDoctorPasswordAction, type ResetPasswordFormState } from "../actions";
import { BrandedButton, BrandedInput } from "@/app/admin/(dashboard)/components/branded";

const initialState: ResetPasswordFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <BrandedButton
      type="submit"
      disabled={pending}
      variant="primary"
    >
      {pending ? "Saving…" : "Set password"}
    </BrandedButton>
  );
}

export function ResetDoctorPasswordForm({
  doctorId,
  email
}: {
  doctorId: string;
  email: string | null;
}) {
  const boundAction = resetDoctorPasswordAction.bind(null, doctorId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <div>
      <p className="text-sm text-slate-500">
        {email
          ? `This doctor can log into the Doctor Portal with ${email}.`
          : "This doctor has no portal login yet — set one up below."}
      </p>

      <form ref={formRef} action={formAction} className="mt-4 flex max-w-sm flex-col gap-3">
        <BrandedInput
          label="Email"
          type="email"
          name="email"
          required
          defaultValue={email ?? ""}
        />

        <BrandedInput
          label="New password"
          type="password"
          name="password"
          required
          minLength={8}
        />

        <BrandedInput
          label="Confirm new password"
          type="password"
          name="confirmPassword"
          required
          minLength={8}
        />

        <div className="flex items-center gap-3">
          <SubmitButton />
          {state.success && <span className="text-sm text-emerald-700">Password updated.</span>}
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}

      <p className="mt-3 text-xs text-slate-400">
        Note: if this doctor is already logged into the portal on another device, that session
        stays active until it expires (up to 12 hours) — it isn&apos;t signed out immediately.
      </p>
    </div>
  );
}
