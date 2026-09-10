"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

/**
 * BrandedModal - Modal dialog with clinic branding
 *
 * Features:
 * - Branded title
 * - Optional action buttons
 * - Click outside to close
 * - Multiple sizes
 */
export function BrandedModal({
  isOpen,
  onClose,
  title,
  children,
  actions,
  size = "md"
}: BrandedModalProps) {
  const branding = useBranding();

  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg"
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className={`w-full ${sizeClasses[size]} rounded-lg bg-white shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="border-b border-slate-200 px-6 py-4"
          style={{ borderBottomColor: `${branding.primaryColor}30` }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: branding.primaryColor }}
          >
            {title}
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">{children}</div>

        {/* Actions */}
        {actions && (
          <div
            className="border-t border-slate-200 flex justify-end gap-3 px-6 py-4"
            style={{ borderTopColor: `${branding.primaryColor}30` }}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
