import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * True if this is the first time we've seen `messageId` — inserts a
 * dedup row atomically via ON CONFLICT DO NOTHING and reports whether
 * the insert actually happened. See migration 0005 for why this
 * replaces the Apps Script version's CacheService-based dance.
 */
export async function tryBeginMessageProcessing(
  supabase: SupabaseClient<Database>,
  messageId: string
): Promise<boolean> {
  if (!messageId) {
    return true;
  }

  const { data, error } = await supabase
    .from("whatsapp_message_dedup")
    .insert({ message_id: messageId })
    .select("message_id")
    .maybeSingle();

  if (error) {
    // Postgres unique_violation — another request already claimed this
    // message_id, i.e. a genuine duplicate delivery.
    if (error.code === "23505") {
      return false;
    }

    throw new Error(`Failed to check message dedup: ${error.message}`);
  }

  return data !== null;
}
