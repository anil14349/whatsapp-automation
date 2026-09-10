"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedCardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  headerColor?: boolean;
}

/**
 * BrandedCard - Card component with optional branded header
 *
 * Features:
 * - Optional title with brand color
 * - White background with border
 * - Shadow and rounded corners
 * - Optional colored top border
 */
export function BrandedCard({
  children,
  title,
  className = "",
  headerColor = false
}: BrandedCardProps) {
  const branding = useBranding();

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
      style={{
        borderTopWidth: headerColor ? "4px" : "1px",
        borderTopColor: headerColor ? branding.primaryColor : "inherit"
      }}
    >
      {title && (
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="font-semibold text-slate-900" style={{ color: branding.primaryColor }}>
            {title}
          </h3>
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}
