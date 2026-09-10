"use client";

import Link from "next/link";
import React from "react";
import { useBranding } from "@/lib/branding/context";

export interface BrandedLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}

/**
 * BrandedLink - Link component using clinic branding
 *
 * Features:
 * - Uses primary color
 * - Hover effect with opacity
 * - Works with Next.js Link and regular <a>
 */
export function BrandedLink({
  href,
  children,
  external = false,
  className = "",
  ...props
}: BrandedLinkProps) {
  const branding = useBranding();

  const linkClass = `font-medium transition-opacity hover:opacity-80 ${className}`;
  const linkStyle = { color: branding.primaryColor };

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        style={linkStyle}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={linkClass} style={linkStyle} {...props}>
      {children}
    </Link>
  );
}
