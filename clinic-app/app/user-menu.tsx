"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDismissable } from "./portal-nav";

/**
 * Name, role and sign out behind one control.
 *
 * All three used to sit in the header as separate items, which is what made it
 * too wide to fit on a single row. It also leaves somewhere to put account
 * actions as more roles arrive.
 */
export function UserMenu({
    name,
    role,
    canManage
}: {
    name: string;
    role: string;
    canManage: boolean;
}) {
    const router = useRouter();
    const { open, setOpen, ref } = useDismissable();

    async function signOut() {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-haspopup="menu"
                className="flex max-w-[12rem] items-center gap-1.5 rounded-lg border border-slate-200 py-1.5 pl-2 pr-1.5 text-sm text-slate-600 transition hover:border-slate-300"
            >
                <span className="truncate">{name}</span>
                <svg
                    viewBox="0 0 20 20"
                    className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                >
                    <path d="m5.5 8 4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                >
                    <div className="border-b border-slate-100 px-3 py-2.5">
                        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                        <p className="text-xs text-slate-500">{role}</p>
                    </div>

                    <div className="py-1">
                        {canManage && (
                            <Link
                                href="/settings"
                                role="menuitem"
                                onClick={() => setOpen(false)}
                                className="block px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                            >
                                Settings
                            </Link>
                        )}
                        <button
                            type="button"
                            role="menuitem"
                            onClick={signOut}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
