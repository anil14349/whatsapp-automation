/**
 * Finding a booking without knowing its date.
 *
 * The day list answers "who is coming today". It cannot answer "when is Mrs
 * Sharma booked", which is what the desk is asked when the phone rings, and
 * stepping back through days one at a time is not a search.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

/** Below this a search matches most of the clinic and helps nobody. */
export const MIN_SEARCH_LENGTH = 3;

/** Enough rows to find anyone, few enough to stay one page. */
export const SEARCH_LIMIT = 50;

export interface SearchOutcome {
    appointments: unknown[];
    tooShort: boolean;
}

/**
 * Decide whether what was typed is a phone number.
 *
 * A name and a number are looked up in the one field that can hold them rather
 * than both at once: "9876" against a name column only ever costs a scan and
 * returns nothing. The slack of three allows spaces, a plus and brackets in a
 * number without letting "Anita 42" count as one.
 */
export function looksLikePhone(term: string): boolean {
    const digits = term.replace(/\D/g, "");

    return digits.length >= 4 && digits.length >= term.length - 3;
}

export async function searchAppointments(
    supabase: SupabaseClient,
    clinicId: string,
    term: string
): Promise<SearchOutcome | null> {
    // % and _ are wildcards to LIKE, so left in, a search for "%" would return
    // the clinic's entire history.
    const cleaned = term.trim().replace(/[%_\\]/g, "");

    if (cleaned.length < MIN_SEARCH_LENGTH) {
        return { appointments: [], tooShort: true };
    }

    let query = supabase
        .from("appointments")
        .select("*, doctor:doctors(id, name), service_type:service_types(code, name)")
        .eq("clinic_id", clinicId);

    // ilike() encodes its pattern. An .or() string here would let a search term
    // become filter syntax.
    query = looksLikePhone(cleaned)
        ? query.ilike("patient_phone", `%${cleaned.replace(/\D/g, "")}%`)
        : query.ilike("patient_name", `%${cleaned}%`);

    const { data, error } = await query
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false })
        .limit(SEARCH_LIMIT);

    if (error) {
        debug("appointmentSearch", "Search failed", { clinicId, error: error.message });
        return null;
    }

    return { appointments: data ?? [], tooShort: false };
}
