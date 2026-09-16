/**
 * Whether a booking continues a recent visit.
 *
 * A clinic that offers a free follow-up within a few days had no way to say so,
 * and the front desk had to remember who was returning. The window is decided
 * once, when the appointment is booked, because changing the clinic's setting
 * later should not silently reclassify visits that are already in the diary.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

export interface RevisitCheck {
    isRevisit: boolean;
    /** The visit this one follows, when there is one. */
    previousDate?: string;
    windowDays: number;
}

export async function getRevisitWindowDays(
    supabase: SupabaseClient,
    clinicId: string
): Promise<number> {
    const { data } = await supabase
        .from("clinics")
        .select("revisit_window_days")
        .eq("id", clinicId)
        .maybeSingle();

    return Number(data?.revisit_window_days ?? 0) || 0;
}

/**
 * A revisit is a return to the same doctor within the window.
 *
 * Tied to the doctor rather than the clinic: seeing a different doctor is a new
 * opinion, not a follow-up. A service with no doctor has nothing to follow up.
 */
export async function checkRevisit(
    supabase: SupabaseClient,
    clinicId: string,
    patientPhone: string,
    doctorId: string | null | undefined,
    appointmentDate: string
): Promise<RevisitCheck> {
    const windowDays = await getRevisitWindowDays(supabase, clinicId);

    if (windowDays <= 0 || !doctorId || !patientPhone) {
        return { isRevisit: false, windowDays };
    }

    const earliest = shiftDate(appointmentDate, -windowDays);

    const { data, error } = await supabase
        .from("appointments")
        .select("appointment_date")
        .eq("clinic_id", clinicId)
        .eq("patient_phone", patientPhone)
        .eq("doctor_id", doctorId)
        .eq("status", "COMPLETED")
        .gte("appointment_date", earliest)
        .lt("appointment_date", appointmentDate)
        .order("appointment_date", { ascending: false })
        .limit(1);

    if (error) {
        debug("revisit", "Lookup failed", { clinicId, error: error.message });
        return { isRevisit: false, windowDays };
    }

    const previous = data?.[0];

    return previous
        ? { isRevisit: true, previousDate: String(previous.appointment_date), windowDays }
        : { isRevisit: false, windowDays };
}

function shiftDate(date: string, days: number): string {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
