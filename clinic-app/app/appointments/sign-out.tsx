"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
    const router = useRouter();

    async function signOut() {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    return (
        <button
            onClick={signOut}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-300"
        >
            Sign out
        </button>
    );
}
