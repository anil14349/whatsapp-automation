/**
 * Which appointments a doctor may see documents for.
 *
 * Lives here rather than inside the endpoint so it can be tested: importing
 * patient-documents/index.ts would start its Deno.serve listener.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * The ids of a doctor's own appointments, narrowed by whatever the caller
 * asked for. `null` means the lookup failed and nothing should be shown.
 */
export async function ownedAppointmentIds(
  supabase: SupabaseClient,
  clinicId: string,
  doctorId: string,
  scope: { appointmentId?: string | null; phone?: string | null }
): Promise<string[] | null> {
  let owned = supabase
    .from("appointments")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId);

  if (scope.appointmentId) {
    owned = owned.eq("id", scope.appointmentId);
  } else if (scope.phone) {
    owned = owned.eq("patient_phone", scope.phone.replace(/\D/g, ""));
  }

  const { data, error } = await owned.limit(500);

  if (error) {
    return null;
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}
