import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getBooleanSetting, getSetting } from "@/lib/settings";
import { combineDateAndTime } from "@/lib/scheduling/dates";

/**
 * Auto-marks past Confirmed appointments Completed once enough time has
 * passed after their start time. Ports
 * src/Model_AppointmentStatus.gs's autoCompletePastAppointments — meant
 * to be called on a schedule (see app/api/cron/auto-complete/route.ts).
 */

export interface AutoCompleteRunResult {
  enabled: boolean;
  updated: number;
  skipped: number;
}

export async function autoCompletePastAppointments(
  supabase: SupabaseClient<Database>,
  timezone: string
): Promise<AutoCompleteRunResult> {
  const enabled = await getBooleanSetting(supabase, "AUTO_COMPLETE_PAST_APPOINTMENTS", false);

  if (!enabled) {
    return { enabled: false, updated: 0, skipped: 0 };
  }

  const hoursAfterRaw = await getSetting(supabase, "AUTO_COMPLETE_HOURS_AFTER", "4");
  const hoursAfterParsed = Number(hoursAfterRaw);
  const cutoffMs = (hoursAfterParsed > 0 ? hoursAfterParsed : 4) * 60 * 60 * 1000;

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id, appointment_date, appointment_time")
    .eq("status", "Confirmed");

  if (error) {
    throw new Error(`Failed to load appointments for auto-complete: ${error.message}`);
  }

  const now = Date.now();
  let updated = 0;
  let skipped = 0;
  const idsToComplete: string[] = [];

  for (const appointment of appointments) {
    const appointmentStart = combineDateAndTime(
      appointment.appointment_date,
      appointment.appointment_time,
      timezone
    );

    if (now < appointmentStart.getTime() + cutoffMs) {
      skipped++;
      continue;
    }

    idsToComplete.push(appointment.id);
  }

  if (idsToComplete.length > 0) {
    const { data: updatedRows, error: updateError } = await supabase
      .from("appointments")
      .update({ status: "Completed" })
      .in("id", idsToComplete)
      .eq("status", "Confirmed") // re-check at write time against a concurrent change (e.g. a doctor cancelling it in between)
      .select("id");

    if (updateError) {
      throw new Error(`Failed to auto-complete appointments: ${updateError.message}`);
    }

    updated = updatedRows.length;
  }

  return { enabled: true, updated, skipped };
}
