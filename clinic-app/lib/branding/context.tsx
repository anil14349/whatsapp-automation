"use client";

import React, { createContext, useContext } from "react";
import { type ClinicBranding } from "./clinic";

/**
 * BrandingContext - Provides clinic branding throughout the app
 */
const BrandingContext = createContext<ClinicBranding | null>(null);

interface BrandingProviderProps {
  children: React.ReactNode;
  branding: ClinicBranding;
}

/**
 * BrandingProvider - Wrap app with branding context
 */
export function BrandingProvider({ children, branding }: BrandingProviderProps) {
  // Generate CSS variables for Tailwind
  const style = document.documentElement.style;
  style.setProperty("--color-brand-primary", branding.primaryColor);
  style.setProperty("--color-brand-secondary", branding.secondaryColor);
  style.setProperty("--color-brand-accent", branding.accentColor);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

/**
 * useBranding - Access branding in any component
 */
export function useBranding(): ClinicBranding {
  const branding = useContext(BrandingContext);
  if (!branding) {
    throw new Error("useBranding must be used within BrandingProvider");
  }
  return branding;
}

/**
 * Get branding in non-client context (server components)
 * This is a helper for typing - actual branding passed via props
 */
export function useOptionalBranding(): ClinicBranding | null {
  return useContext(BrandingContext);
}

/**
 * Style helpers for branding
 */
export function getBrandingStyles(branding: ClinicBranding) {
  return {
    primary: branding.primaryColor,
    secondary: branding.secondaryColor,
    accent: branding.accentColor,
    isDark: isColorDark(branding.primaryColor),
    bgPrimary: `${branding.primaryColor}15`, // 8% opacity
    bgSecondary: `${branding.secondaryColor}15`,
    bgAccent: `${branding.accentColor}15`
  };
}

/**
 * Check if color is dark (for text contrast)
 */
function isColorDark(hexColor: string): boolean {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}
