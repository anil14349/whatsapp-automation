"use client";

import React from "react";
import { useBranding } from "@/lib/branding/context";

/**
 * BrandedTable - Table components with clinic branding
 *
 * Components:
 * - BrandedTable: Container
 * - BrandedTableHeader: Table header with brand color
 * - BrandedTableRow: Table row with hover effects
 * - BrandedTableCell: Table cell
 */

export function BrandedTable({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-slate-200 ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function BrandedTableHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const branding = useBranding();

  return (
    <thead>
      <tr style={{ backgroundColor: `${branding.primaryColor}10` }}>
        {React.Children.map(children, (child) =>
          React.cloneElement(child as React.ReactElement, {
            className: `px-4 py-3 text-left font-semibold text-slate-700 ${className}`
          })
        )}
      </tr>
    </thead>
  );
}

interface BrandedTableRowProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function BrandedTableRow({ children, onClick, className = "" }: BrandedTableRowProps) {
  const branding = useBranding();

  return (
    <tr
      onClick={onClick}
      className={`border-t border-slate-100 transition-colors hover:bg-slate-50 ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
      style={
        onClick
          ? {
              backgroundColor: "inherit",
              "--hover-bg": `${branding.primaryColor}05`
            }
          : {}
      }
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.backgroundColor = `${branding.primaryColor}05`;
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.backgroundColor = "inherit";
        }
      }}
    >
      {children}
    </tr>
  );
}

export function BrandedTableCell({
  children,
  className = "",
  ...props
}: { children: React.ReactNode; className?: string } & React.TdHTMLAttributes<HTMLTableDataCellElement>) {
  return (
    <td className={`px-4 py-3 text-slate-900 ${className}`} {...props}>
      {children}
    </td>
  );
}
