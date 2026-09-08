import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Ports appendWhatsAppLogEntry — writes to the consolidated message_log
 * table (was the WhatsApp_Log sheet). "REMINDER" rows double as the
 * reminder scheduler's own dedup ledger (see lib/reminders.ts) —
 * appointment_id + hours_before + status="SUCCESS" is the same
 * "has this exact reminder already been sent" check the Apps Script
 * version did against this same sheet, just via a real indexed query
 * (message_log_reminder_dedup_idx) instead of scanning every row.
 */
export async function logMessage(
  supabase: SupabaseClient<Database>,
  entry: {
    direction: "IN" | "OUT" | "ERROR" | "REMINDER";
    phone?: string;
    patientName?: string;
    status?: string;
    message?: string;
    phoneNumberId?: string;
    appointmentId?: string;
    hoursBefore?: number;
  }
): Promise<void> {
  const { error } = await supabase.from("message_log").insert({
    direction: entry.direction,
    phone: entry.phone ?? "",
    patient_name: entry.patientName ?? "",
    status: entry.status ?? "",
    message: entry.message ?? "",
    phone_number_id: entry.phoneNumberId ?? "",
    appointment_id: entry.appointmentId ?? null,
    hours_before: entry.hoursBefore ?? null
  });

  if (error) {
    // Logging failures shouldn't break the actual webhook response —
    // matches the Apps Script version's try/catch-and-continue around
    // its own debug logging.
    console.error("Failed to write message_log entry.", error);
  }
}

/** Has this appointment+lead-time reminder already been sent successfully? Backs sendAppointmentReminders' dedup check. */
export async function hasReminderBeenSent(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  hoursBefore: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("message_log")
    .select("id")
    .eq("direction", "REMINDER")
    .eq("appointment_id", appointmentId)
    .eq("hours_before", hoursBefore)
    .eq("status", "SUCCESS")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check reminder dedup log: ${error.message}`);
  }

  return data !== null;
}
