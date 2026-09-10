/**
 * Clinic Settings Loader
 *
 * Load clinic-specific settings from database with caching.
 * Replaces lib/settings.ts global settings with per-clinic settings.
 *
 * Example:
 *   const radius = await getClinicSettingNumber(supabase, clinicId, "home_collection_radius", 5);
 *   const enabled = await getClinicSettingBoolean(supabase, clinicId, "enable_home_collection", true);
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getSettings, getSetting, getSettingNumber, getSettingBoolean } from "./cache";

/**
 * Get all clinic settings as a map
 */
export async function getClinicSettings(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<Record<string, string>> {
  if (!clinicId) {
    return {};
  }

  try {
    return await getSettings(supabase, clinicId);
  } catch (error) {
    console.warn("Failed to load clinic settings:", error);
    return {};
  }
}

/**
 * Get string setting
 */
export async function getClinicSetting(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  key: string,
  defaultValue: string = ""
): Promise<string> {
  if (!clinicId) {
    return defaultValue;
  }

  try {
    return await getSetting(supabase, clinicId, key, defaultValue);
  } catch (error) {
    console.warn(`Failed to load setting ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Get number setting
 */
export async function getClinicSettingNumber(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  key: string,
  defaultValue: number = 0
): Promise<number> {
  if (!clinicId) {
    return defaultValue;
  }

  try {
    return await getSettingNumber(supabase, clinicId, key, defaultValue);
  } catch (error) {
    console.warn(`Failed to load setting ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Get boolean setting
 */
export async function getClinicSettingBoolean(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  key: string,
  defaultValue: boolean = false
): Promise<boolean> {
  if (!clinicId) {
    return defaultValue;
  }

  try {
    return await getSettingBoolean(supabase, clinicId, key, defaultValue);
  } catch (error) {
    console.warn(`Failed to load setting ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Common clinic settings keys and their defaults
 */
export const COMMON_CLINIC_SETTINGS = {
  HOME_COLLECTION_RADIUS: { key: "home_collection_radius", type: "number", default: 5 },
  MAX_BOOKING_DAYS: { key: "max_booking_days", type: "number", default: 30 },
  ENABLE_DOCTOR_PORTAL: { key: "enable_doctor_portal", type: "boolean", default: true },
  APPOINTMENT_REMINDER_HOURS: { key: "appointment_reminder_hours", type: "number", default: 24 },
  HOSPITAL_LOCATION: { key: "hospital_location", type: "string", default: "" },
  CLINIC_NAME: { key: "clinic_name", type: "string", default: "Clinic" },
  ENABLE_HOME_COLLECTION: { key: "enable_home_collection", type: "boolean", default: false },
  ENABLE_INTERACTIVE_MENUS: { key: "enable_interactive_menus", type: "boolean", default: true },
  ENABLE_DOCTOR_BROADCAST: { key: "enable_doctor_broadcast", type: "boolean", default: true }
};

/**
 * Quick getters for common settings
 */
export async function getHomeCollectionRadius(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<number> {
  return getClinicSettingNumber(supabase, clinicId, "home_collection_radius", 5);
}

export async function getMaxBookingDays(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<number> {
  return getClinicSettingNumber(supabase, clinicId, "max_booking_days", 30);
}

export async function getAppointmentReminderHours(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<number> {
  return getClinicSettingNumber(supabase, clinicId, "appointment_reminder_hours", 24);
}

export async function isHomeCollectionEnabled(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<boolean> {
  return getClinicSettingBoolean(supabase, clinicId, "enable_home_collection", false);
}

export async function isDoctorPortalEnabled(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<boolean> {
  return getClinicSettingBoolean(supabase, clinicId, "enable_doctor_portal", true);
}

export async function getHospitalLocation(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<{ latitude: number; longitude: number } | null> {
  const location = await getClinicSetting(supabase, clinicId, "hospital_location", "");

  if (!location) {
    return null;
  }

  const [lat, lon] = location.split(",").map(Number);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return { latitude: lat, longitude: lon };
}
