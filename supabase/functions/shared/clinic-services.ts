/**
 * What a clinic actually offers.
 *
 * `service_types` is a shared catalogue; `clinic_services` is each clinic's
 * selection from it, with optional price and duration overrides. Everything
 * here resolves the two together so callers never have to remember that a null
 * override means "inherit" rather than "free".
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

export interface ClinicService {
    serviceTypeId: string;
    code: string;
    name: string;
    category: string;
    requiresDoctor: boolean;
    offeredAtClinic: boolean;
    offeredAtHome: boolean;
    clinicPrice: number | null;
    homePrice: number | null;
    durationMinutes: number;
    concurrentCapacity: number;
    displayOrder: number;
}

export type ServiceChannel = "clinic" | "home";

/**
 * The clinic-wide switches that sit above per-service selection.
 *
 * These columns already existed and were read by nothing, so a clinic could
 * switch off home collection and still be offered it.
 */
interface MasterSwitches {
    consultations: boolean;
    diagnostics: boolean;
    homeCollection: boolean;
    doctorHomeVisits: boolean;
}

interface CacheEntry {
    services: ClinicService[];
    master: MasterSwitches;
    expiresAt: number;
}

// Short: a clinic that just enabled a service expects to see it immediately.
const TTL_MS = 30_000;

const cache: Record<string, CacheEntry> = {};

export function clearClinicServiceCache(): void {
    for (const key of Object.keys(cache)) {
        delete cache[key];
    }
}

function toService(row: Record<string, any>): ClinicService | null {
    const type = row.service_type;

    if (!type) {
        return null;
    }

    return {
        serviceTypeId: row.service_type_id,
        code: type.code,
        name: type.name,
        category: type.category,
        requiresDoctor: row.requires_doctor !== false,
        offeredAtClinic: row.offered_at_clinic !== false,
        offeredAtHome: row.offered_at_home === true,
        // A null override inherits the catalogue price; it does not mean free.
        clinicPrice: row.clinic_price ?? type.default_clinic_price ?? null,
        homePrice: row.home_price ?? type.default_home_price ?? null,
        durationMinutes: row.duration_minutes ?? type.default_duration_minutes ?? 30,
        concurrentCapacity: row.concurrent_capacity ?? 1,
        displayOrder: row.display_order ?? 0
    };
}

/**
 * Which master switch governs a category.
 *
 * Vaccines have no switch of their own, so they follow per-service selection
 * alone rather than being silently attached to diagnostics.
 */
function allowedByMasterSwitch(
    service: ClinicService,
    channel: ServiceChannel,
    master: MasterSwitches
): boolean {
    const isConsultation = service.category === "CONSULTATION";

    if (channel === "home") {
        return isConsultation ? master.doctorHomeVisits : master.homeCollection;
    }

    if (isConsultation) {
        return master.consultations;
    }

    if (service.category === "DIAGNOSTIC" || service.category === "IMAGING") {
        return master.diagnostics;
    }

    return true;
}

/**
 * Services this clinic offers, in display order.
 *
 * `channel` narrows to what can be done in the clinic or at the patient's home.
 * Without a channel the master switches cannot be applied, so callers that
 * intend to show something to a patient should always pass one.
 */
export async function getEnabledServices(
    supabase: SupabaseClient,
    clinicId: string,
    channel?: ServiceChannel
): Promise<ClinicService[]> {
    const hit = cache[clinicId];

    let services: ClinicService[];
    let master: MasterSwitches;

    if (hit && hit.expiresAt > Date.now()) {
        services = hit.services;
        master = hit.master;
    } else {
        const [servicesResult, clinicResult] = await Promise.all([
            supabase
                .from("clinic_services")
                .select(
                    "service_type_id, requires_doctor, offered_at_clinic, offered_at_home, clinic_price, home_price, duration_minutes, concurrent_capacity, display_order, " +
                    "service_type:service_types(code, name, category, default_clinic_price, default_home_price, default_duration_minutes, is_active)"
                )
                .eq("clinic_id", clinicId)
                .eq("is_enabled", true)
                .order("display_order", { ascending: true }),
            supabase
                .from("clinics")
                .select(
                    "enable_doctor_consultations, enable_diagnostic_center, enable_home_collection, enable_doctor_home_visits"
                )
                .eq("id", clinicId)
                .maybeSingle()
        ]);

        if (servicesResult.error) {
            debug("clinicServices", "Lookup failed", {
                clinicId,
                error: servicesResult.error.message
            });
            return [];
        }

        const flags = clinicResult.data;

        // A missing clinic row must not silently open everything up.
        master = {
            consultations: flags?.enable_doctor_consultations !== false,
            diagnostics: flags?.enable_diagnostic_center !== false,
            homeCollection: flags?.enable_home_collection === true,
            doctorHomeVisits: flags?.enable_doctor_home_visits === true
        };

        services = (servicesResult.data ?? [])
            .filter((row: Record<string, any>) => row.service_type?.is_active !== false)
            .map(toService)
            .filter((s): s is ClinicService => s !== null);

        cache[clinicId] = { services, master, expiresAt: Date.now() + TTL_MS };
    }

    if (channel === "clinic") {
        return services.filter(
            (s) => s.offeredAtClinic && allowedByMasterSwitch(s, "clinic", master)
        );
    }

    if (channel === "home") {
        return services.filter(
            (s) => s.offeredAtHome && allowedByMasterSwitch(s, "home", master)
        );
    }

    return services;
}

export async function getServiceById(
    supabase: SupabaseClient,
    clinicId: string,
    serviceTypeId: string
): Promise<ClinicService | null> {
    const services = await getEnabledServices(supabase, clinicId);
    return services.find((s) => s.serviceTypeId === serviceTypeId) ?? null;
}

export async function getServiceByCode(
    supabase: SupabaseClient,
    clinicId: string,
    code: string
): Promise<ClinicService | null> {
    const services = await getEnabledServices(supabase, clinicId);
    return services.find((s) => s.code === code) ?? null;
}

/**
 * The service to fall back to when a clinic has configured nothing.
 *
 * Without this a misconfigured clinic would render an empty menu and the bot
 * would look broken to patients.
 */
export async function getFallbackServiceTypeId(
    supabase: SupabaseClient
): Promise<string | null> {
    const { data } = await supabase
        .from("service_types")
        .select("id")
        .eq("code", "CONSULTATION")
        .maybeSingle();

    return data?.id ?? null;
}

export function formatPrice(amount: number | null, language: string): string {
    if (amount === null || Number.isNaN(amount)) {
        return "";
    }

    const rounded = Number(amount);
    const value = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);

    return language === "EN" ? `₹${value}` : `₹${value}`;
}
