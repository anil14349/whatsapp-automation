"use client";

/**
 * A switch, for settings that are simply on or off.
 *
 * A button labelled with its own state reads as either a statement or a
 * command: "Offered" could mean it is, or that pressing it will make it so.
 * A switch says which without being asked.
 */
export function Switch({
    checked,
    onChange,
    label,
    disabled = false,
    describe
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
    /** Announced to screen readers, which cannot see the row it sits in. */
    label: string;
    disabled?: boolean;
    describe?: (checked: boolean) => string;
}) {
    return (
        <span className="inline-flex items-center gap-2">
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                    checked ? "bg-emerald-500" : "bg-slate-300"
                }`}
            >
                <span
                    className={`inline-block h-[1.125rem] w-[1.125rem] transform rounded-full bg-white shadow transition ${
                        checked ? "translate-x-6" : "translate-x-1"
                    }`}
                />
            </button>

            {describe && (
                <span
                    className={`text-sm ${checked ? "text-emerald-700" : "text-slate-500"}`}
                    aria-hidden="true"
                >
                    {describe(checked)}
                </span>
            )}
        </span>
    );
}
