"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  size?: "sm" | "md";
  className?: string;
}

/**
 * BrandedBadge - Status badge using clinic branding
 *
 * Variants:
 * - default: Primary color
 * - success: Green
 * - warning: Orange
 * - danger: Red
 * - info: Blue
 */
export function BrandedBadge({
  children,
  variant = "default",
  size = "md",
  className = "",
  ...props
}: BrandedBadgeProps) {
  const branding = useBranding();

  const getColor = () => {
    switch (variant) {
      case "success":
        return "#10b981";
      case "warning":
        return "#f59e0b";
      case "danger":
        return "#ef4444";
      case "info":
        return "#3b82f6";
      default:
        return branding.accentColor;
    }
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm"
  };

  const color = getColor();

  return (
    <span
      className={`rounded-full font-medium text-white ${sizeClasses[size]} ${className}`}
      style={{ backgroundColor: color }}
      {...props}
    >
      {children}
    </span>
  );
}
