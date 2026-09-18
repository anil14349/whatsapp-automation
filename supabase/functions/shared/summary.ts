/**
 * How the clinic is doing.
 *
 * The owner had no view of their own clinic beyond one day's list. There is an
 * analytics_events table, but trackEvent() is called from nowhere and it has
 * never held a row, so counting it would produce a page of confident zeroes.
 * Appointments already record what an owner actually asks: how busy, how many
 * did not turn up, how much of it came through WhatsApp rather than the desk.
 *
 * Counted in the clinic's own timezone. A day boundary drawn in UTC would move
 * the morning's bookings into yesterday for a clinic in Asia/Kolkata.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";
import { asLocationType } from "./location-type.ts";

/**
 * Beyond this the numbers would be built from part of the period, which is
 * worse than saying so: a wrong total reads exactly like a right one.
 */
export const MAX_ROWS = 5000;

export interface Summary {
    from: string;
    to: string;
    booked: number;
    completed: number;
    noShow: number;
    cancelled: number;
    stillToBeSeen: number;
    noShowRate: number | null;
    revisits: number;
    bySource: Record<string, number>;
    byLocation: Record<string, number>;
    byDoctor: Array<{ name: string; count: number }>;
    busiestHours: Array<{ hour: string; count: number }>;
    feedback: { rated: number; average: number | null };
    documents: { sent: number; failed: number };
    reminders: { sent: number; failed: number };
    /** True when the period held more rows than were counted. */
    truncated: boolean;
}

function tally(into: Record<string, number>, key: string): void {
    into[key] = (into[key] ?? 0) + 1;
}

export async function buildSummary(
    supabase: SupabaseClient,
    clinicId: string,
    from: string,
    to: string
): Promise<Summary | null> {
    // The three counts do not depend on the appointments, so waiting for that
    // query before starting them made the slowest screen slower still.
    const [appointments, feedback, documents, reminders] = await Promise.all([
        supabase
            .from("appointments")
            .select("status, booking_source, location_type, is_revisit, appointment_time, doctor:doctors(name)")
            .eq("clinic_id", clinicId)
            .gte("appointment_date", from)
            .lte("appointment_date", to)
            .limit(MAX_ROWS + 1),
        feedbackSummary(supabase, clinicId, from, to),
        documentSummary(supabase, clinicId, from, to),
        reminderSummary(supabase, clinicId, from, to)
    ]);

    const { data, error } = appointments;

    if (error) {
        debug("summary", "Appointment read failed", { clinicId, error: error.message });
        return null;
    }

    const rows = data ?? [];
    const truncated = rows.length > MAX_ROWS;
    const counted = truncated ? rows.slice(0, MAX_ROWS) : rows;

    const bySource: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    const doctorCounts: Record<string, number> = {};
    const hourCounts: Record<string, number> = {};

    let completed = 0;
    let noShow = 0;
    let cancelled = 0;
    let stillToBeSeen = 0;
    let revisits = 0;

    for (const row of counted) {
        const status = String(row.status ?? "");

        if (status === "COMPLETED") completed++;
        else if (status === "NO_SHOW") noShow++;
        else if (status === "CANCELLED") cancelled++;
        else stillToBeSeen++;

        // A cancelled appointment is not business the clinic did, so it stays
        // out of everything except its own count.
        if (status === "CANCELLED") {
            continue;
        }

        if (row.is_revisit === true) revisits++;

        tally(bySource, String(row.booking_source ?? "WHATSAPP"));
        tally(byLocation, asLocationType(row.location_type));

        const doctor = (row as Record<string, any>).doctor;
        tally(doctorCounts, doctor?.name ? `Dr ${doctor.name}` : "No doctor needed");

        const time = String(row.appointment_time ?? "");

        if (/^\d{2}:/.test(time)) {
            tally(hourCounts, `${time.slice(0, 2)}:00`);
        }
    }

    const seen = completed + noShow;

    return {
        from,
        to,
        booked: counted.length - cancelled,
        completed,
        noShow,
        cancelled,
        stillToBeSeen,
        // A rate over nobody is not zero, it is unknown.
        noShowRate: seen > 0 ? Math.round((noShow / seen) * 100) : null,
        revisits,
        bySource,
        byLocation,
        byDoctor: Object.entries(doctorCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
        busiestHours: Object.entries(hourCounts)
            .map(([hour, count]) => ({ hour, count }))
            .sort((a, b) => a.hour.localeCompare(b.hour)),
        feedback,
        documents,
        reminders,
        truncated
    };
}

async function feedbackSummary(
    supabase: SupabaseClient,
    clinicId: string,
    from: string,
    to: string
): Promise<{ rated: number; average: number | null }> {
    const { data, error } = await supabase
        .from("feedback")
        .select("rating")
        .eq("clinic_id", clinicId)
        .not("rating", "is", null)
        .gte("submitted_at", `${from}T00:00:00`)
        .lte("submitted_at", `${to}T23:59:59`)
        .limit(MAX_ROWS);

    if (error || !data || data.length === 0) {
        return { rated: 0, average: null };
    }

    const total = data.reduce((sum, row) => sum + Number(row.rating ?? 0), 0);

    return {
        rated: data.length,
        average: Math.round((total / data.length) * 10) / 10
    };
}

async function countWhere(
    supabase: SupabaseClient,
    table: string,
    clinicId: string,
    column: string,
    from: string,
    to: string,
    status: string
): Promise<number> {
    const { count, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", status)
        .gte(column, `${from}T00:00:00`)
        .lte(column, `${to}T23:59:59`);

    if (error) {
        debug("summary", "Count failed", { table, status, error: error.message });
        return 0;
    }

    return count ?? 0;
}

async function documentSummary(
    supabase: SupabaseClient,
    clinicId: string,
    from: string,
    to: string
): Promise<{ sent: number; failed: number }> {
    const [sent, failed] = await Promise.all([
        countWhere(supabase, "patient_documents", clinicId, "created_at", from, to, "SENT"),
        countWhere(supabase, "patient_documents", clinicId, "created_at", from, to, "FAILED")
    ]);

    return { sent, failed };
}

async function reminderSummary(
    supabase: SupabaseClient,
    clinicId: string,
    from: string,
    to: string
): Promise<{ sent: number; failed: number }> {
    const [sent, failed] = await Promise.all([
        countWhere(supabase, "appointment_reminders", clinicId, "scheduled_time", from, to, "SENT"),
        countWhere(supabase, "appointment_reminders", clinicId, "scheduled_time", from, to, "FAILED")
    ]);

    return { sent, failed };
}
