"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * BrandedTextarea - Textarea component using clinic branding
 *
 * Features:
 * - Focus border uses primary color
 * - Optional label and error text
 * - Helper text support
 */
export function BrandedTextarea({
  label,
  error,
  helperText,
  className = "",
  id,
  ...props
}: BrandedTextareaProps) {
  const branding = useBranding();

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm transition-colors font-mono ${
          error ? "border-red-500" : "border-slate-300"
        } ${className}`}
        style={{ borderColor: error ? "#ef4444" : "#cbd5e1" }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = error
            ? "#ef4444"
            : branding.primaryColor;
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
