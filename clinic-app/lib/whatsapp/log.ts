import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getBooleanSetting, getNumberSetting } from "@/lib/settings";

/**
 * Ports appendWhatsAppLogEntry — writes to the consolidated message_log
 * table (was the WhatsApp_Log sheet). "REMINDER" rows double as the
 * reminder scheduler's own dedup ledger (see lib/reminders.ts) —
 * appointment_id + hours_before + status="SUCCESS" is the same
 * "has this exact reminder already been sent" check the Apps Script
 * version did against this same sheet, just via a real indexed query
 * (message_log_reminder_dedup_idx) instead of scanning every row.
 *
 * ENABLE_INBOUND_LOG/ENABLE_DEBUG_LOG only gate IN/OUT rows — ERROR and
 * REMINDER rows are always written regardless, same as the Apps Script
 * version: an error matters no matter what, and the reminder ledger is
 * functional dedup state the scheduler depends on, not optional
 * diagnostics (see hasReminderBeenSent below and its doc comment on
 * lib/reminders.ts). LOG_MESSAGE_MAX_CHARS truncates every row's
 * `message` regardless of direction.
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
  try {
    if (entry.direction === "IN" && !(await getBooleanSetting(supabase, "ENABLE_INBOUND_LOG", true))) {
      return;
    }

    if (entry.direction === "OUT" && !(await getBooleanSetting(supabase, "ENABLE_DEBUG_LOG", true))) {
      return;
    }

    const maxChars = await getNumberSetting(supabase, "LOG_MESSAGE_MAX_CHARS", 500);
    const message = entry.message ?? "";
    const truncatedMessage =
      maxChars > 0 && message.length > maxChars ? `${message.slice(0, maxChars)}…` : message;

    const { error } = await supabase.from("message_log").insert({
      direction: entry.direction,
      phone: entry.phone ?? "",
      patient_name: entry.patientName ?? "",
      status: entry.status ?? "",
      message: truncatedMessage,
      phone_number_id: entry.phoneNumberId ?? "",
      appointment_id: entry.appointmentId ?? null,
      hours_before: entry.hoursBefore ?? null
    });

    if (error) {
      throw error;
    }
  } catch (error) {
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
