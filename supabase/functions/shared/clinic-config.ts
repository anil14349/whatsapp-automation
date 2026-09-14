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
            clinic_name: data.name || "ABC Clinic",
            clinic_phone: data.phone || "+91-9999999999",
            clinic_email: data.email || "info@clinic.com",
            open_time: data.open_time || "09:00",
            close_time: data.close_time || "18:00",
            working_days: data.working_days || "Mon,Tue,Wed,Thu,Fri,Sat",
            timezone: data.timezone || "Asia/Kolkata",
            enable_after_hours_reply: data.enable_after_hours_reply === true,
            after_hours_message: data.after_hours_message || undefined,
            address: data.address,
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
 */
function getDefaultClinicConfig(clinicId: string): ClinicConfig {
    return {
        clinic_id: clinicId,
        clinic_name: "ABC Clinic",
        clinic_phone: "+91-9999999999",
        clinic_email: "info@clinic.com",
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
 * Check if clinic is open at given time
 */
export function isClinicOpen(config: ClinicConfig, date: Date): boolean {
    // Edge functions run in UTC, so day and time must be read in the clinic timezone.
    const { dayOfWeek, currentTime } = getLocalDayAndTime(date, config.timezone);

    const workingDays = config.working_days.split(",").map((d) => d.trim());
    if (!workingDays.includes(dayOfWeek)) {
        return false; // Clinic closed on this day
    }

    return currentTime >= config.open_time && currentTime < config.close_time;
}

/**
 * Resolve the short weekday and HH:MM for a timestamp in the given IANA timezone
 */
function getLocalDayAndTime(
    date: Date,
    timezone: string
): { dayOfWeek: string; currentTime: string } {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).formatToParts(date);

        const lookup = (type: string) =>
            parts.find((part) => part.type === type)?.value || "";

        // Intl can emit "24" for midnight in hourCycle h23/h24 edge cases.
        const hour = lookup("hour") === "24" ? "00" : lookup("hour");

        return {
            dayOfWeek: lookup("weekday"),
            currentTime: `${hour}:${lookup("minute")}`
        };
    } catch {
        return {
            dayOfWeek: date.toLocaleString("en-US", { weekday: "short" }),
            currentTime: date.toISOString().substring(11, 16)
        };
    }
}

/**
 * Format clinic hours for display
 */
export function formatClinicHours(config: ClinicConfig): string {
    return `${config.open_time} - ${config.close_time}`;
}

/**
 * Format working days for display
 */
export function formatWorkingDays(config: ClinicConfig): string {
    const days = config.working_days.split(",").map((d) => d.trim());
    return days.join(", ");
}

/**
 * Get after-hours message
 */
export function getAfterHoursMessage(config: ClinicConfig): string {
    if (config.after_hours_message) {
        return config.after_hours_message;
    }

    return (
        `⏰ We're currently closed.\n\n` +
        `🕐 Clinic Hours: ${formatClinicHours(config)}\n` +
        `📅 Working Days: ${formatWorkingDays(config)}\n` +
        `📞 Call us: ${config.clinic_phone}\n\n` +
        `Your message has been received. We'll respond during our working hours.`
    );
}

/**
 * Get clinic greeting
 */
export function getClinicGreeting(config: ClinicConfig): string {
    return `👋 Welcome to ${config.clinic_name}!\n\nPlease select your language:\n\n1️⃣ English\n2️⃣ हिंदी\n3️⃣ తెలుగు`;
}
