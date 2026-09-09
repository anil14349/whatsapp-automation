import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClinicNameSafe } from "@/lib/settings";
import { listDoctors } from "@/lib/doctors";

/**
 * This app has no patient-facing website — patients only ever interact
 * over WhatsApp (see app/api/whatsapp/webhook/route.ts); this page is
 * just what a browser hitting the bare domain sees. Kept intentionally
 * minimal rather than built out into a marketing site, but shows real,
 * per-deployment data (clinic name, active doctor count) instead of
 * static placeholder text, so it's obviously "this hospital's instance"
 * rather than a generic template screen.
 */
export default async function HomePage() {
  const clinicName = await getClinicNameSafe(getSupabaseServerClient);

  let activeDoctorCount: number | null = null;

  try {
    activeDoctorCount = (
      await listDoctors(getSupabaseServerClient(), { activeOnly: true })
    ).length;
  } catch (error) {
    console.error("Failed to load doctor count for the landing page.", error);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">{clinicName}</h1>
      <p className="max-w-md text-slate-600">
        Patients book, reschedule, and manage appointments directly over WhatsApp — there&apos;s
        no separate patient website. This is the backend + admin console for clinic staff.
      </p>

      {activeDoctorCount !== null && (
        <p className="text-sm text-slate-500">
          {activeDoctorCount} active {activeDoctorCount === 1 ? "doctor" : "doctors"} configured.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/admin"
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Admin / Receptionist Console
        </Link>

        <Link
          href="/doctor"
          className="rounded-md border border-brand-600 px-4 py-2 font-medium text-brand-700 hover:bg-brand-50"
        >
          Doctor Portal
        </Link>
      </div>

      <p className="text-xs text-slate-400">
        WhatsApp webhook:{" "}
        <code className="rounded bg-slate-200 px-1.5 py-0.5">/api/whatsapp/webhook</code>
      </p>
    </main>
  );
}
