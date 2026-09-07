import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Replaces getSetting()/ensureSettingsSheet() from src/Config.gs. The
 * Apps Script version needed a whole caching layer (see README
 * "Reliability & security hardening") because reading one setting meant
 * scanning the entire Settings sheet — often more than once per message.
 * A single indexed Postgres SELECT doesn't have that problem, so there's
 * no cache here at all; this is simpler *because* the new architecture
 * removed the reason the old one needed to be complicated.
 */

export type SettingsRow = Database["public"]["Tables"]["settings"]["Row"];

/** All settings as a plain key->value map (every value is stored as text; parse as needed). */
export async function getAllSettings(
  supabase: SupabaseClient<Database>
): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("settings").select("key, value");

  if (error) {
    throw new Error(`Failed to load settings: ${error.message}`);
  }

  const map: Record<string, string> = {};

  for (const row of data) {
    map[row.key] = row.value;
  }

  return map;
}

export async function getSetting(
  supabase: SupabaseClient<Database>,
  key: string,
  defaultValue: string
): Promise<string> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read setting "${key}": ${error.message}`);
  }

  return data?.value ?? defaultValue;
}

export async function getBooleanSetting(
  supabase: SupabaseClient<Database>,
  key: string,
  defaultValue: boolean
): Promise<boolean> {
  const raw = await getSetting(supabase, key, defaultValue ? "TRUE" : "FALSE");
  return raw.trim().toUpperCase() === "TRUE";
}

export async function getNumberSetting(
  supabase: SupabaseClient<Database>,
  key: string,
  defaultValue: number
): Promise<number> {
  const raw = await getSetting(supabase, key, String(defaultValue));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Upserts one setting — used by the admin UI's Settings page. */
export async function setSetting(
  supabase: SupabaseClient<Database>,
  key: string,
  value: string
): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) {
    throw new Error(`Failed to save setting "${key}": ${error.message}`);
  }
}
