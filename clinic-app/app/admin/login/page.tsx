import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClinicNameSafe } from "@/lib/settings";
import { getClinicBranding } from "@/lib/branding/clinic";
import { LoginForm } from "./LoginForm";

export default async function AdminLoginPage() {
  const supabase = getSupabaseServerClient();
  const [clinicName, branding] = await Promise.all([
    getClinicNameSafe(supabase),
    getClinicBranding(supabase, process.env.NEXT_PUBLIC_CLINIC_ID || "").catch(() => null)
  ]);

  const primaryColor = branding?.primaryColor || "#0066cc";
  const accentColor = branding?.accentColor || "#ff6600";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* Logo */}
        {branding?.logoUrl && (
          <div className="mb-6 flex items-center justify-center h-12">
            <img
              src={branding.logoUrl}
              alt="Logo"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}

        <h1 className="text-lg font-semibold text-slate-900">{clinicName} Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to manage doctors, appointments, and settings.</p>

        <div className="mt-6">
          <LoginForm primaryColor={primaryColor} />
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Looking for the Doctor Portal instead?{" "}
          <Link
            href="/doctor/login"
            className="font-medium hover:opacity-80 transition-opacity"
            style={{ color: primaryColor }}
          >
            Sign in here
          </Link>
        </p>
      </div>
    </main>
  );
}
