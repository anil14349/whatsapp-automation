"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

/**
 * BrandedButton - Button component using clinic branding
 *
 * Variants:
 * - primary: Primary action (uses primary color)
 * - secondary: Secondary action (uses secondary color)
 * - danger: Destructive action (red)
 * - success: Positive action (green)
 */
export function BrandedButton({
  variant = "primary",
  size = "md",
  className = "",
  onClick,
  disabled,
  ...props
}: BrandedButtonProps) {
  const branding = useBranding();

  const sizeClasses = {
    sm: "px-2 py-1 text-sm",
    md: "px-4 py-2 text-sm font-medium",
    lg: "px-6 py-3 text-base font-medium"
  };

  // Get base color based on variant
  const getBaseColor = () => {
    switch (variant) {
      case "primary":
        return branding.primaryColor;
      case "secondary":
        return branding.secondaryColor;
      case "danger":
        return "#dc2626"; // Red
      case "success":
        return "#16a34a"; // Green
      default:
        return branding.primaryColor;
    }
  };

  const baseColor = getBaseColor();

  // Darken color for hover (15% darker)
  const darkenColor = (hex: string, percent: number = 0.15) => {
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
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${sizeClasses[size]} ${className}`}
      style={{
        backgroundColor: baseColor
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = darkenColor(baseColor);
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = baseColor;
      }}
      {...props}
    />
  );
}
