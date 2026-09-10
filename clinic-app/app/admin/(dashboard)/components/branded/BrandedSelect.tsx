"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string | number; label: string }>;
}

/**
 * BrandedSelect - Select component using clinic branding
 *
 * Features:
 * - Focus border uses primary color
 * - Optional label and error text
 * - Type-safe options
 */
export function BrandedSelect({
  label,
  error,
  options,
  className = "",
  id,
  ...props
}: BrandedSelectProps) {
  const branding = useBranding();

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm transition-colors ${
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
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
