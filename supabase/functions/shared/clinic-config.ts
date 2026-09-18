import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

/**
 * Clinic Configuration Manager
 * Loads and caches clinic metadata from Supabase
 * Includes: clinic name, phone, hours, working days
 */

interface ClinicConfig {
    clinic_id: string;
    clinic_name: string;
    clinic_phone: string;
    clinic_email: string;
    open_time: string; // HH:MM format
    close_time: string; // HH:MM format
    working_days: string; // comma-separated: Mon,Tue,Wed,Thu,Fri,Sat
    timezone: string;
    enable_after_hours_reply: boolean;
    after_hours_message?: string;
    address?: string;
    city?: string;
    website?: string;
}

// Cached per isolate. Warm isolates are reused for a long time, so entries
// expire to let clinic setting changes take effect without a redeploy.
let __clinicConfigCache: { [clinicId: string]: { config: ClinicConfig; expiresAt: number } } = {};

const CLINIC_CONFIG_TTL_MS = 60_000;

/**
 * Load clinic configuration from Supabase
 * Cached per execution to avoid repeated DB queries
 */
export async function getClinicConfig(
    supabase: SupabaseClient,
    clinicId: string
): Promise<ClinicConfig> {
    // Check cache first
    const cached = __clinicConfigCache[clinicId];
    if (cached && cached.expiresAt > Date.now()) {
        return cached.config;
    }

    try {
        const { data, error } = await supabase
            .from("clinics")
            .select("*")
            .eq("id", clinicId)
            .maybeSingle();

        if (error || !data) {
            debug("clinicConfig", "Failed to load clinic config", {
                error: error?.message,
                clinicId
            });

            // Return default config
            return getDefaultClinicConfig(clinicId);
        }

        const config: ClinicConfig = {
            clinic_id: data.id || clinicId,
            clinic_name: data.name || "our clinic",
            clinic_phone: data.phone || "",
            clinic_email: data.email || "",
            open_time: data.open_time || "09:00",
            close_time: data.close_time || "18:00",
            working_days: data.working_days || "Mon,Tue,Wed,Thu,Fri,Sat",
            timezone: data.timezone || "Asia/Kolkata",
            enable_after_hours_reply: data.enable_after_hours_reply === true,
            after_hours_message: data.after_hours_message || undefined,
            address: data.address,
            city: data.city,
            website: data.website
        };

        // Cache the config
        __clinicConfigCache[clinicId] = {
            config,
            expiresAt: Date.now() + CLINIC_CONFIG_TTL_MS
        };

        return config;
    } catch (error) {
        debug("clinicConfig", "Error loading clinic config", {
            error: error instanceof Error ? error.message : String(error)
        });

        return getDefaultClinicConfig(clinicId);
    }
}

/**
 * Get default clinic configuration for fallback
 *
 * Naming a real clinic here would greet one clinic's patients with another's
 * brand, and inventing a phone number sends them somewhere that does not exist.
 */
function getDefaultClinicConfig(clinicId: string): ClinicConfig {
    return {
        clinic_id: clinicId,
        clinic_name: "our clinic",
        clinic_phone: "",
        clinic_email: "",
        open_time: "09:00",
        close_time: "18:00",
        working_days: "Mon,Tue,Wed,Thu,Fri,Sat",
        timezone: "Asia/Kolkata",
        enable_after_hours_reply: false
    };
}

/**
 * Clear clinic config cache (useful for testing or config updates)
 */
export function clearClinicConfigCache(): void {
    __clinicConfigCache = {};
}

/**
 * Get after-hours message
 */
export function getAfterHoursMessage(
    config: ClinicConfig,
    /** Today's own hours. Omitted or null means the clinic is shut all day. */
    todayHours?: { openTime: string; closeTime: string } | null
): string {
    if (config.after_hours_message) {
        return config.after_hours_message;
    }

    const hours = todayHours
        ? `🕐 Today we are open ${todayHours.openTime} - ${todayHours.closeTime}\n`
        : `🕐 We are closed today.\n`;

    return (
        `⏰ We're currently closed.\n\n` +
        hours +
        `📞 Call us: ${config.clinic_phone}\n\n` +
        `Your message has been received. We'll respond during our working hours.`
    );
}

/**
 * Get clinic greeting
 */
export function getClinicGreeting(config: ClinicConfig): string {
    return `👋 Welcome to ${config.clinic_name}!\n\nPlease select your language:`;
}
