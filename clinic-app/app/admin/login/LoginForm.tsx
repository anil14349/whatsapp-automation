"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = {};

interface SubmitButtonProps {
  primaryColor?: string;
  pending: boolean;
}

function SubmitButton({ primaryColor = "#0066cc", pending }: SubmitButtonProps) {
  // Darken color for hover state
  const darkenedColor = darkenColor(primaryColor, 0.15);

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md px-4 py-2.5 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        backgroundColor: primaryColor,
        opacity: pending ? 0.6 : 1
      }}
      onMouseEnter={(e) => {
        if (!pending) {
          e.currentTarget.style.backgroundColor = darkenedColor;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = primaryColor;
      }}
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

function SubmitButtonWrapper({ primaryColor }: { primaryColor?: string }) {
  const { pending } = useFormStatus();
  return <SubmitButton primaryColor={primaryColor} pending={pending} />;
}

interface LoginFormProps {
  primaryColor?: string;
}

export function LoginForm({ primaryColor = "#0066cc" }: LoginFormProps) {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={{
            focusBorderColor: primaryColor,
            focusRingColor: primaryColor
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = primaryColor;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#cbd5e1";
          }}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1"
          onFocus={(e) => {
            e.currentTarget.style.borderColor = primaryColor;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#cbd5e1";
          }}
        />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <SubmitButtonWrapper primaryColor={primaryColor} />
    </form>
  );
}

/**
 * Darken a hex color
 */
function darkenColor(hex: string, percent: number): string {
  let num = parseInt(hex.replace("#", ""), 16);
  let amt = Math.round(2.55 * percent * 100);
  let R = (num >> 16) - amt;
  let G = ((num >> 8) & 0x00ff) - amt;
  let B = (num & 0x0000ff) - amt;
  return (
    "#" +
    (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
  );
}
