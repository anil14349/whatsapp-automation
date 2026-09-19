"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface NavLink {
    href: string;
    label: string;
}

function useIsActive() {
    const pathname = usePathname();

    return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Which screen you are on, shown by a teal underline on the header's own edge.
 *
 * Each link fills the header height so the underline sits on the bottom border
 * rather than floating under the word.
 */
export function PortalNav({ links }: { links: NavLink[] }) {
    const isActive = useIsActive();

    return (
        <nav className="hidden h-16 items-center md:flex">
            {links.map((link) => {
                const active = isActive(link.href);

                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className="relative flex h-16 items-center px-1"
                    >
                        <span
                            className={`rounded-lg px-3 py-1.5 text-sm transition ${
                                active
                                    ? "font-semibold text-brand-500"
                                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            }`}
                        >
                            {link.label}
                        </span>
                        {active && (
                            <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-brand-500" />
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}

/**
 * The same links as a menu, below the width where they fit on one row.
 *
 * They used to wrap, which pushed the account controls onto a second line and
 * left the header half empty.
 */
export function PortalNavMenu({ links }: { links: NavLink[] }) {
    const isActive = useIsActive();
    const { open, setOpen, ref } = useDismissable();

    return (
        <div ref={ref} className="relative md:hidden">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label="Menu"
                className="flex items-center rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300"
            >
                <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                >
                    <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
                </svg>
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                >
                    {links.map((link) => {
                        const active = isActive(link.href);

                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                role="menuitem"
                                aria-current={active ? "page" : undefined}
                                onClick={() => setOpen(false)}
                                className={`block px-3 py-2 text-sm transition ${
                                    active
                                        ? "bg-brand-50 font-semibold text-brand-500"
                                        : "text-slate-600 hover:bg-slate-50"
                                }`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/** Close on a click elsewhere or on Escape, so a menu is never stuck open. */
export function useDismissable() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        function onPointerDown(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return { open, setOpen, ref };
}
