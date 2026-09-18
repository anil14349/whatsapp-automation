"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const MENU_ITEM =
    "w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";

export const MENU_DANGER =
    "w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50";

/**
 * The actions a row needs occasionally, folded away.
 *
 * Rendered into the body rather than the row: a table clipped to its rounded
 * corners swallows the menu whole.
 */
export function RowMenu({
    open,
    onToggle,
    children
}: {
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    const button = useRef<HTMLButtonElement>(null);
    const [at, setAt] = useState<{ top: number; right: number } | null>(null);

    useEffect(() => {
        if (!open) {
            setAt(null);
            return;
        }

        const place = () => {
            const box = button.current?.getBoundingClientRect();
            if (box) setAt({ top: box.bottom + 6, right: window.innerWidth - box.right });
        };

        place();

        const close = () => onToggle();
        window.addEventListener("click", close);
        // Following the button on scroll is not worth it; closing is honest.
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);

        return () => {
            window.removeEventListener("click", close);
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        };
    }, [open, onToggle]);

    return (
        <>
            <button
                type="button"
                ref={button}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                aria-label="More actions"
                aria-expanded={open}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold leading-none text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
            >
                •••
            </button>

            {open &&
                at &&
                createPortal(
                    <div
                        style={{ position: "fixed", top: at.top, right: at.right }}
                        onClick={(e) => e.stopPropagation()}
                        className="z-50 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                    >
                        {children}
                    </div>,
                    document.body
                )}
        </>
    );
}
