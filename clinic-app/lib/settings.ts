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
 * Safe-for-anywhere clinic name lookup — used by app/layout.tsx,
 * app/page.tsx, and the admin login page, none of which should ever
 * hard-fail just because Supabase/env vars are unreachable or
 * unconfigured (unlike the rest of the app, these can render before
 * .env is fully set up, or during static generation of routes like
 * Next's own /_not-found — there's no "the user is already past the
 * point of needing the database" escape hatch for these).
 *
 * Takes a *factory function*, not an already-constructed client —
 * getSupabaseServerClient() itself throws synchronously if env vars are
 * missing, before ever reaching a Supabase call this function's own
 * try/catch could catch. Passing the function reference (e.g.
 * `getClinicNameSafe(getSupabaseServerClient)`, not
 * `getClinicNameSafe(getSupabaseServerClient())`) defers that throw to
 * inside the try block below, where it's actually caught. Found the
 * hard way: an early version passed the client pre-constructed and
 * broke the entire production build (not just this page) the moment
 * .env.local wasn't present during `next build`.
 */
export async function getClinicNameSafe(
  getClient: () => SupabaseClient<Database>
): Promise<string> {
  try {
    return await getSetting(getClient(), "CLINIC_NAME", "ABC Clinic");
  } catch (error) {
    console.error("Failed to read CLINIC_NAME setting; using default.", error);
    return "ABC Clinic";
  }
}

/**
 * Settings keys that are seeded with a default and editable in
 * /admin/settings, but have no code reading them yet. Empty as of the
 * log-retention/truncation cleanup job — every setting seeded by
 * migration 0001/0006 now has real code behind it. Kept as a mechanism
 * (not deleted) for whatever setting is added next without code to
 * match on day one.
 *
 * This is the single source of truth the Settings UI reads to show a
 * "not yet active" badge — add a key here the moment a new setting is
 * introduced ahead of the feature that reads it, and remove it again in
 * the same change that wires that feature up, so the UI and
 * CONFIGURATION.md can't silently drift out of sync with what the code
 * actually does.
 */
export const DORMANT_SETTING_KEYS: ReadonlySet<string> = new Set([]);

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

/**
 * Ported from getClinicWelcomeImageUrl in src/WhatsApp_Send.gs. Optional
 * image sent alongside the greeting (see lib/whatsapp/router.ts) —
 * blank/unset means "no welcome image", same as CLINIC_LOGO_URL's
 * "no logo" default. Returns the raw setting text; validate with
 * isRenderableLogoUrl (lib/whatsapp/receipt.tsx) before using it, same
 * http(s)-only check the receipt card's logo uses.
 */
export async function getClinicWelcomeImageUrl(
  supabase: SupabaseClient<Database>
): Promise<string> {
  return getSetting(supabase, "CLINIC_WELCOME_IMAGE_URL", "");
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
