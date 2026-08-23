"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { demoUrl, site } from "@/lib/site";

const links = [
  { href: "#solution", label: "Solution" },
  { href: "#ownership", label: "Ownership" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  return (
    <header className="glass-nav fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2"
          onClick={closeMenu}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-soft">
            {site.brandName.charAt(0)}
          </span>
          <div className="leading-tight">
            <span className="block text-lg font-bold text-slate-900">
              {site.brandName}
            </span>
            <span className="hidden text-xs text-slate-500 sm:block">
              Clinic WhatsApp booking
            </span>
          </div>
        </Link>

        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Main navigation"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition hover:text-brand-700"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={demoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700 sm:inline-flex"
          >
            Free demo
          </a>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <CloseIcon className="h-5 w-5" />
            ) : (
              <MenuIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 top-[72px] z-40 bg-slate-900/30 backdrop-blur-sm md:hidden"
            aria-label="Close menu overlay"
            onClick={closeMenu}
          />
          <nav
            id="mobile-nav"
            className="absolute inset-x-0 top-full z-50 border-b border-slate-200 bg-white px-4 py-4 shadow-lg md:hidden"
            aria-label="Mobile navigation"
          >
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="block rounded-xl px-4 py-3 text-base font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-800"
                    onClick={closeMenu}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-full bg-whatsapp py-3 text-center text-sm font-semibold text-white transition hover:brightness-105"
                onClick={closeMenu}
              >
                Book free demo on WhatsApp
              </a>
              <a
                href="#demo"
                className="block rounded-full border border-slate-200 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
                onClick={closeMenu}
              >
                See product preview
              </a>
            </div>
          </nav>
        </>
      )}
    </header>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
