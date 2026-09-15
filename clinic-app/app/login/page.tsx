"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "doctor" | "receptionist" | "owner";

const ROLES: Array<{ value: Role; label: string; secretLabel: string }> = [
    { value: "receptionist", label: "Receptionist", secretLabel: "Password" },
    { value: "doctor", label: "Doctor", secretLabel: "PIN" },
    { value: "owner", label: "Clinic owner", secretLabel: "Password" }
];

export default function LoginPage() {
    const router = useRouter();
    const [role, setRole] = useState<Role>("receptionist");
    const [email, setEmail] = useState("");
    const [secret, setSecret] = useState("");
    const [clinicId, setClinicId] = useState(process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID ?? "");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const active = ROLES.find((r) => r.value === role)!;

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);

        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, email, secret, clinicId })
        });

        const data = await response.json();
        setBusy(false);

        if (!response.ok) {
            setError(data.error ?? "Sign in failed");
            return;
        }

        router.push("/appointments");
        router.refresh();
    }

    return (
        <main className="flex min-h-screen items-center justify-center p-6">
            <form
                onSubmit={submit}
                className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
            >
                <div>
                    <h1 className="text-xl font-semibold">Clinic Portal</h1>
                    <p className="mt-1 text-sm text-slate-500">Sign in to manage your clinic.</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    {ROLES.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setRole(option.value)}
                            className={`rounded-lg border px-3 py-2 text-sm transition ${
                                role === option.value
                                    ? "border-brand-500 bg-brand-50 text-brand-700"
                                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">Email</span>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
                    />
                </label>

                <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">{active.secretLabel}</span>
                    <input
                        type="password"
                        required
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        inputMode={role === "doctor" ? "numeric" : "text"}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
                    />
                </label>

                <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">
                        Clinic ID {role === "owner" && <span className="text-slate-400">(optional)</span>}
                    </span>
                    <input
                        value={clinicId}
                        onChange={(e) => setClinicId(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500"
                    />
                </label>

                {error && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
                >
                    {busy ? "Signing in…" : "Sign in"}
                </button>
            </form>
        </main>
    );
}
