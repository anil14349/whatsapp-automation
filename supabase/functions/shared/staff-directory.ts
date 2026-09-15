import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDoctorPhones, getSampleCollectorPhones } from "./config.ts";
import { debug } from "./logger.ts";

/**
 * Staff identity, scoped to a clinic.
 *
 * Doctors live in `doctors` and collectors in `sample_collectors`, both keyed
 * by clinic. The DOCTOR_PHONES / SAMPLE_COLLECTOR_PHONES env lists remain as a
 * fallback for the original single-clinic deployment, but they apply only to
 * DEFAULT_CLINIC_ID so one clinic's staff can never gain access to another's.
 */

export type StaffRole = "DOCTOR" | "HOME_COLLECTION_PERSON" | "PATIENT";

export interface Collector {
    phone: string;
    name: string;
    maxPerDay: number;
}

function isDefaultClinic(clinicId: string): boolean {
    const defaultId = Deno.env.get("DEFAULT_CLINIC_ID");
    return Boolean(defaultId) && clinicId === defaultId;
}

export async function getRoleByPhoneForClinic(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<StaffRole> {
    const normalized = phone.trim();

    try {
        const { data: doctor } = await supabase
            .from("doctors")
            .select("id")
            .eq("clinic_id", clinicId)
            .eq("phone", normalized)
            .eq("is_active", true)
            .maybeSingle();

        if (doctor) {
            return "DOCTOR";
        }

        const { data: collector } = await supabase
            .from("sample_collectors")
            .select("id")
            .eq("clinic_id", clinicId)
            .eq("phone", normalized)
            .eq("is_active", true)
            .maybeSingle();

        if (collector) {
            return "HOME_COLLECTION_PERSON";
        }
    } catch (error) {
        debug("staffDirectory", "Role lookup failed, falling back to env lists", {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    // Env lists are only meaningful for the original single-clinic install.
    if (isDefaultClinic(clinicId)) {
        if (getDoctorPhones().includes(normalized)) {
            return "DOCTOR";
        }

        if (getSampleCollectorPhones().includes(normalized)) {
            return "HOME_COLLECTION_PERSON";
        }
    }

    return "PATIENT";
}

/**
 * Active collectors for a clinic, falling back to the env list for the
 * default clinic so existing dispatch keeps working.
 */
export async function getCollectorsForClinic(
    supabase: SupabaseClient,
    clinicId: string
): Promise<Collector[]> {
    try {
        const { data, error } = await supabase
            .from("sample_collectors")
            .select("phone, name, max_collections_per_day")
            .eq("clinic_id", clinicId)
            .eq("is_active", true);

        if (!error && data && data.length > 0) {
            return data.map((row) => ({
                phone: row.phone,
                name: row.name,
                maxPerDay: row.max_collections_per_day ?? 8
            }));
        }
    } catch (error) {
        debug("staffDirectory", "Collector lookup failed", {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    if (!isDefaultClinic(clinicId)) {
        return [];
    }

    return getSampleCollectorPhones().map((phone) => ({
        phone,
        name: "Collector",
        maxPerDay: 8
    }));
}
