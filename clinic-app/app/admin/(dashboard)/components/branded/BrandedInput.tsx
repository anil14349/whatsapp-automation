"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * BrandedInput - Input component using clinic branding
 *
 * Features:
 * - Focus border uses primary color
 * - Optional label and error text
 * - Helper text support
 */
export function BrandedInput({
  label,
  error,
  helperText,
  className = "",
  id,
  ...props
}: BrandedInputProps) {
  const branding = useBranding();

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-slate-700"
        >
          {label}
        </label>
      )}
      <input
        id={id}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm transition-colors ${
          error ? "border-red-500" : "border-slate-300"
        } ${className}`}
        style={{
          borderColor: error ? "#ef4444" : "#cbd5e1"
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = error
            ? "#ef4444"
            : branding.primaryColor;
          e.currentTarget.style.outline = "none";
          e.currentTarget.style.boxShadow = `0 0 0 3px ${branding.primaryColor}20`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? "#ef4444" : "#cbd5e1";
          e.currentTarget.style.boxShadow = "none";
        }}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      {helperText && !error && (
        <p className="text-xs text-slate-500">{helperText}</p>
      )}
    </div>
  );
}
