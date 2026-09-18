/**
 * Which collector a home visit goes to.
 *
 * Every collector used to see every visit and could close any of them, which
 * is workable with one and wrong with two: the second closes the first one's
 * round. A visit is assigned when it is booked.
 *
 * Nobody is assigned when every collector is already at their daily limit, or
 * when the clinic has no collectors yet. The visit is still booked and sits
 * unclaimed rather than vanishing, because refusing a patient to protect a
 * rota is the wrong way round.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCollectorsForClinic, type Collector } from "./staff-directory.ts";
import { debug } from "./logger.ts";

/**
 * The collector with the lightest day who is not already full.
 *
 * Counting per day rather than round-robin, because a collector who called in
 * sick and has no visits should get the next one.
 */
export async function pickCollector(
    supabase: SupabaseClient,
    clinicId: string,
    date: string
): Promise<Collector | null> {
    const collectors = await getCollectorsForClinic(supabase, clinicId);

    if (collectors.length === 0) {
        return null;
    }

    const { data, error } = await supabase
        .from("appointments")
        .select("collector_id")
        .eq("clinic_id", clinicId)
        .eq("appointment_date", date)
        .neq("status", "CANCELLED");

    if (error) {
        debug("collectorAssignment", "Could not count the day's visits", {
            clinicId,
            error: error.message
        });
        // Assigning somebody beats leaving it unclaimed on a transient error.
        return collectors[0];
    }

    const load = new Map<string, number>();

    for (const row of data ?? []) {
        if (row.collector_id) {
            load.set(row.collector_id, (load.get(row.collector_id) ?? 0) + 1);
        }
    }

    const free = collectors
        .map((collector) => ({ collector, count: load.get(collector.id) ?? 0 }))
        .filter((entry) => entry.count < entry.collector.maxPerDay)
        .sort((a, b) => a.count - b.count);

    return free.length > 0 ? free[0].collector : null;
}
