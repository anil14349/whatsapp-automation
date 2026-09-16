"use client";

import { useState } from "react";
import { COUNTRIES, DEFAULT_COUNTRY_CODE, joinPhone, splitPhone } from "@/lib/phone";

/**
 * A country picker beside the number, so nobody has to know that a WhatsApp
 * number is stored with its country code glued to the front.
 *
 * Without `onChange` it submits the joined digits under `name`, which suits a
 * plain form. With `onChange` it reports them and the caller holds the value.
 */
export function PhoneField({
    name,
    label = "WhatsApp number",
    defaultValue = "",
    required = false,
    hint,
    onChange,
    children
}: {
    name?: string;
    label?: string;
    defaultValue?: string;
    required?: boolean;
    hint?: string;
    onChange?: (value: string) => void;
    children?: React.ReactNode;
}) {
    const initial = splitPhone(defaultValue);
    const [code, setCode] = useState(initial.code || DEFAULT_COUNTRY_CODE);
    const [national, setNational] = useState(initial.national);

    function update(nextCode: string, nextNational: string) {
        setCode(nextCode);
        setNational(nextNational);
        onChange?.(joinPhone(nextCode, nextNational));
    }

    return (
        <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">{label}</span>

            <div className="flex gap-2">
                <select
                    value={code}
                    onChange={(e) => update(e.target.value, national)}
                    aria-label="Country code"
                    className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                >
                    {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code} title={c.name}>
                            +{c.code}
                        </option>
                    ))}
                </select>

                <input
                    value={national}
                    onChange={(e) => update(code, e.target.value.replace(/\D/g, ""))}
                    required={required}
                    inputMode="tel"
                    placeholder="9876543210"
                    aria-label={label}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
            </div>

            {name && !onChange && (
                <input type="hidden" name={name} value={joinPhone(code, national)} />
            )}

            {hint && <span className="block text-xs text-slate-400">{hint}</span>}
            {children}
        </div>
    );
}
