"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Which screen you are on, shown by a teal underline.
 *
 * Every link looked identical, so the header told you where you could go but
 * not where you were.
 */
export function PortalNav({ links }: { links: Array<{ href: string; label: string }> }) {
    const pathname = usePathname();

    return (
        <nav className="flex items-center gap-1">
            {links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={`relative rounded-lg px-3 py-1.5 text-sm transition ${
                            active
                                ? "font-semibold text-brand-500"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                        {link.label}
                        {active && (
                            <span className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-brand-500" />
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}
