import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeWhatsAppPhone } from "@/lib/phone";

/**
 * Conversation-state persistence. Ports src/Model_Session.gs.
 *
 * Notably simpler than the Apps Script version, which needed a whole
 * CacheService caching layer (see that file's history/README) because a
 * session read meant scanning the entire WhatsApp_Sessions sheet — a
 * cost that grew with total user count. A single indexed lookup on the
 * `phone` primary key doesn't have that problem, so there's no cache
 * here at all, by the same reasoning as lib/settings.ts.
 */

export type WhatsAppSession = Database["public"]["Tables"]["whatsapp_sessions"]["Row"];
export type WhatsAppSessionUpdate =
  Database["public"]["Tables"]["whatsapp_sessions"]["Update"];

export async function getSession(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<WhatsAppSession | null> {
  const normalized = normalizeWhatsAppPhone(phone);

  if (!normalized) {
    return null;
  }

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load session: ${error.message}`);
  }

  return data;
}

export async function saveSession(
  supabase: SupabaseClient<Database>,
  phone: string,
  updates: WhatsAppSessionUpdate
): Promise<WhatsAppSession> {
  const normalized = normalizeWhatsAppPhone(phone);

  if (!normalized) {
    throw new Error("Cannot save a session with a blank phone number.");
  }

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .upsert({ phone: normalized, ...updates }, { onConflict: "phone" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save session: ${error.message}`);
  }

  return data;
}

export async function clearSession(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<void> {
  const normalized = normalizeWhatsAppPhone(phone);

  if (!normalized) {
    return;
  }

  const { error } = await supabase
    .from("whatsapp_sessions")
    .delete()
    .eq("phone", normalized);

  if (error) {
    throw new Error(`Failed to clear session: ${error.message}`);
  }
}
