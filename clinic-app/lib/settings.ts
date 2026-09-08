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

/**
 * Settings keys that are seeded with a default and editable in
 * /admin/settings, but have no code reading them yet — the feature
 * they'd control (log retention/truncation, reminders, after-hours
 * gating, auto-complete, home collection) hasn't been ported from the
 * Apps Script version. See CONFIGURATION.md for the full breakdown of
 * why each one is here.
 *
 * This is the single source of truth the Settings UI reads to show a
 * "not yet active" badge — remove a key from this set in the same
 * change that wires up its feature, so the UI and CONFIGURATION.md
 * can't silently drift out of sync with what the code actually does.
 */
export const DORMANT_SETTING_KEYS: ReadonlySet<string> = new Set([
  "LOG_RETENTION",
  "LOG_MAX_ROWS",
  "LOG_MESSAGE_MAX_CHARS",
  "ENABLE_INBOUND_LOG",
  "ENABLE_DEBUG_LOG",
  "ENABLE_APPOINTMENT_REMINDERS",
  "REMINDER_HOURS_BEFORE",
  "REMINDER_WINDOW_MINUTES",
  "AUTO_COMPLETE_PAST_APPOINTMENTS",
  "AUTO_COMPLETE_HOURS_AFTER",
  "ENABLE_AFTER_HOURS_REPLY",
  "CLINIC_OPEN_TIME",
  "CLINIC_CLOSE_TIME",
  "CLINIC_WORKING_DAYS",
  "AFTER_HOURS_MESSAGE"
]);

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

export interface HospitalLocation {
  lat: number;
  lng: number;
}

/**
 * Ported from getHospitalLocation in src/Config.gs — null if either
 * coordinate is unset, checked against the raw (pre-Number()) setting
 * text so an unconfigured value is never silently treated as a genuine
 * (0, 0) coordinate (Number("") is 0).
 */
export async function getHospitalLocation(
  supabase: SupabaseClient<Database>
): Promise<HospitalLocation | null> {
  const [latText, lngText] = await Promise.all([
    getSetting(supabase, "HOSPITAL_LATITUDE", ""),
    getSetting(supabase, "HOSPITAL_LONGITUDE", "")
  ]);

  if (!latText.trim() || !lngText.trim()) {
    return null;
  }

  const lat = Number(latText);
  const lng = Number(lngText);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Ported from getHomeCollectionRadiusKm in src/Config.gs. */
export async function getHomeCollectionRadiusKm(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const radius = await getNumberSetting(supabase, "HOME_COLLECTION_RADIUS_KM", 5);
  return radius > 0 ? radius : 5;
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
