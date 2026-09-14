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
    address?: string;
    website?: string;
}

// Execution-scoped cache for clinic configs
let __clinicConfigCache: { [clinicId: string]: ClinicConfig } = {};

/**
 * Load clinic configuration from Supabase
 * Cached per execution to avoid repeated DB queries
 */
export async function getClinicConfig(
    supabase: SupabaseClient,
    clinicId: string
): Promise<ClinicConfig> {
    // Check cache first
    if (__clinicConfigCache[clinicId]) {
        return __clinicConfigCache[clinicId];
    }

    try {
        const { data, error } = await supabase
            .from("clinics")
            .select("*")
            .eq("clinic_id", clinicId)
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
            clinic_id: data.clinic_id || clinicId,
            clinic_name: data.clinic_name || "ABC Clinic",
            clinic_phone: data.clinic_phone || "+91-9999999999",
            clinic_email: data.clinic_email || "info@clinic.com",
            open_time: data.open_time || "09:00",
            close_time: data.close_time || "18:00",
            working_days: data.working_days || "Mon,Tue,Wed,Thu,Fri,Sat",
            timezone: data.timezone || "Asia/Kolkata",
            address: data.address,
            website: data.website
        };

        // Cache the config
        __clinicConfigCache[clinicId] = config;

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
        timezone: "Asia/Kolkata"
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
    // Get current day of week
    const dayOfWeek = date.toLocaleString("en-US", { weekday: "short" });

    // Check if today is a working day
    const workingDays = config.working_days.split(",").map((d) => d.trim());
    if (!workingDays.includes(dayOfWeek)) {
        return false; // Clinic closed on this day
    }

    // Check if current time is within clinic hours
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const currentTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

    const openTime = config.open_time;
    const closeTime = config.close_time;

    return currentTime >= openTime && currentTime < closeTime;
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
