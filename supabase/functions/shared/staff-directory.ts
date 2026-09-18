import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

/**
 * Staff identity, scoped to a clinic.
 *
 * Doctors live in `doctors` and collectors in `sample_collectors`, both keyed
 * by clinic. There is no environment fallback: a phone number granted staff
 * access by a list nobody maintains is a second way to become staff, and the
 * lists were never used.
 */

export type StaffRole = "DOCTOR" | "HOME_COLLECTION_PERSON" | "PATIENT";

export interface Collector {
    id: string;
    phone: string;
    name: string;
    maxPerDay: number;
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
        // Losing staff access on a database error is the safe direction: the
        // alternative is granting it to someone we could not verify.
        debug("staffDirectory", "Role lookup failed, treating as patient", {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    return "PATIENT";
}

/**
 * Active collectors for a clinic.
 */
export async function getCollectorsForClinic(
    supabase: SupabaseClient,
    clinicId: string
): Promise<Collector[]> {
    try {
        const { data, error } = await supabase
            .from("sample_collectors")
            .select("id, phone, name, max_collections_per_day")
            .eq("clinic_id", clinicId)
            .eq("is_active", true);

        if (!error && data && data.length > 0) {
            return data.map((row) => ({
                id: row.id,
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

    return [];
}
