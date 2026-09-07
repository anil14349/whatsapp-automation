import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Ports appendWhatsAppLogEntry — writes to the consolidated message_log table (was the WhatsApp_Log sheet). */
export async function logMessage(
  supabase: SupabaseClient<Database>,
  entry: {
    direction: "IN" | "OUT" | "ERROR";
    phone?: string;
    patientName?: string;
    status?: string;
    message?: string;
    phoneNumberId?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("message_log").insert({
    direction: entry.direction,
    phone: entry.phone ?? "",
    patient_name: entry.patientName ?? "",
    status: entry.status ?? "",
    message: entry.message ?? "",
    phone_number_id: entry.phoneNumberId ?? ""
  });

  if (error) {
    // Logging failures shouldn't break the actual webhook response —
    // matches the Apps Script version's try/catch-and-continue around
    // its own debug logging.
    console.error("Failed to write message_log entry.", error);
  }
}
