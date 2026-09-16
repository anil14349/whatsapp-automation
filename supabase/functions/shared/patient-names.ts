/**
 * Who the booking is for.
 *
 * One number books for a household: a mother books for herself, then for her
 * child, then for her father. The name is already asked fresh on every
 * booking and stored on the appointment, so those bookings are distinct — but
 * the whole name has to be typed out every time, on a phone, often in a second
 * language.
 *
 * The names already used from a number are the household. Nothing new has to
 * be recorded to offer them back.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

/** Nine leaves room for "someone else" inside WhatsApp's ten-row limit. */
export const MAX_REMEMBERED_NAMES = 9;

/** How far back to look. A name unused for a year is not the household now. */
const LOOKBACK_DAYS = 365;

/**
 * Names this number has booked under before, most recently used first.
 *
 * Read from appointments rather than a roster of family members: a roster
 * would have to be kept up to date by someone, and this is already true by
 * construction.
 */
export async function knownPatientNames(
    supabase: SupabaseClient,
    clinicId: string,
    phone: string
): Promise<string[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000)
        .toISOString()
        .slice(0, 10);

    const { data, error } = await supabase
        .from("appointments")
        .select("patient_name, appointment_date")
        .eq("clinic_id", clinicId)
        .eq("patient_phone", phone)
        .gte("appointment_date", since)
        .order("appointment_date", { ascending: false })
        .limit(60);

    if (error) {
        debug("patientNames", "Could not read previous names", { error: error.message });
        return [];
    }

    const seen = new Set<string>();
    const names: string[] = [];

    for (const row of data ?? []) {
        const name = String(row.patient_name ?? "").trim();

        // Case-insensitive so "asha rao" and "Asha Rao" are one person, but
        // the spelling they last used is the one offered back.
        const key = name.toLowerCase();

        if (!name || seen.has(key)) {
            continue;
        }

        seen.add(key);
        names.push(name);

        if (names.length >= MAX_REMEMBERED_NAMES) {
            break;
        }
    }

    return names;
}
