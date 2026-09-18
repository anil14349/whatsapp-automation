"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Groups, not a flat list.
 *
 * Only sections that exist are listed. An entry for something unbuilt reads
 * exactly like one that works until it is clicked.
 */
const GROUPS = [
    {
        title: "Clinic",
        items: [
            { href: "/settings", label: "General" },
            { href: "/settings/branding", label: "Appearance" },
            { href: "/settings/hours", label: "Opening hours" },
            { href: "/settings/closures", label: "Closures" }
        ]
    },
    {
        title: "Appointments",
        items: [
            { href: "/settings/booking", label: "Booking rules" },
            { href: "/settings/home-collection", label: "Home collection" }
        ]
    },
    {
        title: "WhatsApp",
        items: [{ href: "/settings/messages", label: "Out of hours" }]
    }
];

export function SettingsNav() {
    const pathname = usePathname();

    return (
        // Sticky below the 64px header: a long section should scroll without
        // taking the way out of it off the screen.
        <nav
            aria-label="Settings sections"
            className="sticky top-20 w-52 shrink-0 space-y-5 self-start"
        >
            {GROUPS.map((group) => (
                <div key={group.title}>
                    <h2 className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {group.title}
                    </h2>
                    <ul className="space-y-0.5">
                        {group.items.map((item) => {
                            // Exact, because General lives at /settings and would
                            // otherwise light up on every section.
                            const active = pathname === item.href;

                            return (
                                <li key={item.href}>
                                    <Link
                                        href={item.href}
                                        aria-current={active ? "page" : undefined}
                                        className={`block rounded-lg px-3 py-1.5 text-sm transition ${
                                            active
                                                ? "bg-brand-50 font-medium text-brand-700"
                                                : "text-slate-600 hover:bg-slate-50"
                                        }`}
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );
}
