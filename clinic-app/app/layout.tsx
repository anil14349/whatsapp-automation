import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClinicNameSafe } from "@/lib/settings";
import "./globals.css";

/**
 * Dynamic per-deployment metadata — reads the clinic's own CLINIC_NAME
 * setting rather than hardcoding "ABC Clinic", which matters once this
 * is deployed per-hospital (see README's multi-hospital section): each
 * hospital's own Supabase project has its own CLINIC_NAME row, so the
 * same codebase renders the right name for whichever one it's talking to.
 */
export async function generateMetadata(): Promise<Metadata> {
  const clinicName = await getClinicNameSafe(getSupabaseServerClient);

  return {
    title: `${clinicName} — Admin`,
    description: `Receptionist/admin console for the ${clinicName} WhatsApp bot`
  };
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
