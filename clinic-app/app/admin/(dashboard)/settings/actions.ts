"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { setSetting } from "@/lib/settings";

export interface FormState {
  error?: string;
  success?: boolean;
}

const BOOLEAN_KEYS = [
  "ENABLE_INBOUND_LOG",
  "ENABLE_DEBUG_LOG",
  "ENABLE_APPOINTMENT_REMINDERS",
  "ENABLE_INTERACTIVE_MENUS",
  "ENABLE_WHATSAPP_FLOW_BOOKING",
  "AUTO_COMPLETE_PAST_APPOINTMENTS",
  "ENABLE_AFTER_HOURS_REPLY"
];

const TEXT_KEYS = [
  "CLINIC_NAME",
  "LOG_RETENTION",
  "LOG_MAX_ROWS",
  "LOG_MESSAGE_MAX_CHARS",
  "REMINDER_HOURS_BEFORE",
  "REMINDER_WINDOW_MINUTES",
  "AUTO_COMPLETE_HOURS_AFTER",
  "CLINIC_OPEN_TIME",
  "CLINIC_CLOSE_TIME",
  "CLINIC_WORKING_DAYS",
  "AFTER_HOURS_MESSAGE",
  "HOSPITAL_LATITUDE",
  "HOSPITAL_LONGITUDE",
  "HOME_COLLECTION_RADIUS_KM"
];

export async function updateSettingsAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const supabase = getSupabaseServerClient();

    for (const key of TEXT_KEYS) {
      const value = formData.get(key);
      if (value !== null) {
        await setSetting(supabase, key, String(value).trim());
      }
    }

    for (const key of BOOLEAN_KEYS) {
      await setSetting(supabase, key, formData.get(key) === "on" ? "TRUE" : "FALSE");
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save settings." };
  }

  revalidatePath("/admin/settings");
  return { success: true };
}
