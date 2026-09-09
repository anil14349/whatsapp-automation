import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClinicNameSafe } from "@/lib/settings";
import { LoginForm } from "./LoginForm";

export default async function DoctorLoginPage() {
  const clinicName = await getClinicNameSafe(getSupabaseServerClient);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{clinicName} Doctor Portal</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to view your schedule and manage your availability.</p>

        <div className="mt-6">
          <LoginForm />
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Looking for the Admin Console instead?{" "}
          <Link href="/admin/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in here
          </Link>
        </p>
      </div>
    </main>
  );
}
