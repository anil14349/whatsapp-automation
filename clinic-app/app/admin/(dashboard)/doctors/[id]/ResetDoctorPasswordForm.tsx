"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { resetDoctorPasswordAction, type ResetPasswordFormState } from "../actions";

const initialState: ResetPasswordFormState = {};
const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Set password"}
    </button>
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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
          <input
            type="email"
            name="email"
            required
            defaultValue={email ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">New password</label>
          <input type="password" name="password" required minLength={8} className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Confirm new password
          </label>
          <input
            type="password"
            name="confirmPassword"
            required
            minLength={8}
            className={inputClass}
          />
        </div>

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
