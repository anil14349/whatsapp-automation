/**
 * Time a doctor is at the clinic but not seeing patients.
 *
 * Standing breaks simply disappear from the slot list — a patient never learns
 * the doctor eats at one, only that one o'clock is not offered.
 *
 * An unplanned break is harder, because people are already booked inside it.
 * Those appointments are moved to the next free slot after the break and the
 * patient is told. Moving somebody without asking is only defensible while two
 * things hold, so both are enforced here rather than left to the caller:
 *
 *   - there is a free slot later the same day with the same doctor. Inventing
 *     a time on another day, or silently cancelling, is worse than leaving the
 *     appointment alone for the desk to sort out.
 *   - the patient can actually be told. Meta refuses a free-form message
 *     outside 24 hours, and a patient moved without being reached would arrive
 *     at a time that no longer exists. If the message cannot go, the move does
 *     not happen.
 *
 * Anything that fails either test is returned as `stranded` so whoever asked
 * for the break can see who still needs a phone call.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { BUTTON_IDS } from "./button-ids.ts";
import { getClinicRouteById } from "./clinic-routing.ts";
import { formatClockTime } from "./appointment-format.ts";
import { sendProactive } from "./proactive.ts";
import { debug } from "./logger.ts";

export interface DoctorBreak {
    id?: string;
    startTime: string;
    endTime: string;
    reason?: string | null;
}

export function toMinutes(hhmm: string): number {
    const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
}

export function toClock(minutes: number): string {
    const capped = Math.max(0, Math.min(minutes, 23 * 60 + 59));
    return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`;
}

/** Postgres gives 1=Monday..7=Sunday; JavaScript gives 0=Sunday. */
export function isoDayOfWeek(date: string): number {
    return new Date(`${date}T00:00:00`).getDay() || 7;
}

/**
 * Both kinds of break for one doctor on one day.
 *
 * Read in one query rather than two: a standing lunch and an unplanned break
 * are the same obstacle to somebody trying to book.
 */
export async function getDoctorBreaks(
    supabase: SupabaseClient,
    clinicId: string,
    doctorId: string,
    date: string
): Promise<DoctorBreak[]> {
    const { data, error } = await supabase
        .from("doctor_breaks")
        .select("id, start_time, end_time, reason, day_of_week, on_date")
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId);

    if (error) {
        // A failed read must not invent free time in the middle of lunch, but
        // it must not empty the diary either. Returning nothing matches how
        // the rest of the slot builder treats a lookup it could not make.
        debug("breaks", "Could not read breaks", { clinicId, doctorId, error: error.message });
        return [];
    }

    const day = isoDayOfWeek(date);

    return (data ?? [])
        .filter((row: Record<string, any>) =>
            row.on_date ? String(row.on_date).slice(0, 10) === date : row.day_of_week === day
        )
        .map((row: Record<string, any>) => ({
            id: row.id,
            startTime: String(row.start_time).slice(0, 5),
            endTime: String(row.end_time).slice(0, 5),
            reason: row.reason ?? null
        }));
}

/** True when a slot starting at `time` falls inside any break. */
export function isDuringBreak(time: string, breaks: DoctorBreak[]): boolean {
    const at = toMinutes(time);

    return breaks.some((b) => at >= toMinutes(b.startTime) && at < toMinutes(b.endTime));
}

export interface BreakOutcome {
    breakId: string | null;
    /** Appointments moved, with where they went. */
    moved: Array<{ appointmentId: string; patientName: string; from: string; to: string }>;
    /** Still sitting inside the break, and why. */
    stranded: Array<{ appointmentId: string; patientName: string; at: string; why: "no_slot" | "unreachable" }>;
}

/**
 * Take an unplanned break, moving whoever was booked inside it.
 *
 * The break is recorded first so that a booking made while this runs cannot
 * land in the window being cleared.
 */
export async function takeBreak(
    supabase: SupabaseClient,
    clinicId: string,
    doctorId: string,
    date: string,
    startTime: string,
    endTime: string,
    reason?: string
): Promise<BreakOutcome> {
    const outcome: BreakOutcome = { breakId: null, moved: [], stranded: [] };

    if (toMinutes(endTime) <= toMinutes(startTime)) {
        return outcome;
    }

    const { data: created, error: insertError } = await supabase
        .from("doctor_breaks")
        .insert({
            clinic_id: clinicId,
            doctor_id: doctorId,
            on_date: date,
            start_time: startTime,
            end_time: endTime,
            reason: reason ?? null
        })
        .select("id")
        .single();

    if (insertError) {
        debug("breaks", "Could not record the break", { clinicId, doctorId, error: insertError.message });
        return outcome;
    }

    outcome.breakId = created?.id ?? null;

    const { data: affected } = await supabase
        .from("appointments")
        .select("id, patient_name, patient_phone, appointment_time, token_number, preferred_language")
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId)
        .eq("appointment_date", date)
        .eq("status", "CONFIRMED")
        .gte("appointment_time", startTime)
        .lt("appointment_time", endTime)
        .order("appointment_time", { ascending: true });

    if (!affected || affected.length === 0) {
        return outcome;
    }

    const route = await getClinicRouteById(supabase, clinicId);

    if (!route) {
        for (const row of affected) {
            outcome.stranded.push({
                appointmentId: row.id,
                patientName: String(row.patient_name ?? "Patient"),
                at: formatClockTime(String(row.appointment_time)),
                why: "unreachable"
            });
        }

        return outcome;
    }

    const client = new WhatsAppClient(route.accessToken, route.phoneNumberId, supabase, clinicId);

    const { data: doctor } = await supabase
        .from("doctors")
        .select("name")
        .eq("id", doctorId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

    const doctorName = doctor?.name ? `Dr. ${doctor.name}` : "the doctor";

    // Read once. Each move adds to it, so two patients cannot be given the
    // same replacement slot.
    const { data: booked } = await supabase
        .from("appointments")
        .select("appointment_time")
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId)
        .eq("appointment_date", date)
        .neq("status", "CANCELLED");

    const taken = new Set((booked ?? []).map((r: Record<string, any>) => String(r.appointment_time).slice(0, 5)));

    const breaks = await getDoctorBreaks(supabase, clinicId, doctorId, date);

    const { data: hours } = await supabase
        .from("doctor_operating_hours")
        .select("closing_time")
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId)
        .eq("day_of_week", isoDayOfWeek(date))
        .maybeSingle();

    const closing = hours?.closing_time ? toMinutes(String(hours.closing_time)) : 24 * 60;

    for (const row of affected) {
        const was = String(row.appointment_time).slice(0, 5);
        const name = String(row.patient_name ?? "Patient");

        // The first free half hour after the break that is not itself a break
        // and not already somebody else's.
        let replacement: string | null = null;

        for (let t = toMinutes(endTime); t + 30 <= closing; t += 30) {
            const candidate = toClock(t);

            if (!taken.has(candidate) && !isDuringBreak(candidate, breaks)) {
                replacement = candidate;
                break;
            }
        }

        if (!replacement) {
            outcome.stranded.push({ appointmentId: row.id, patientName: name, at: formatClockTime(was), why: "no_slot" });
            continue;
        }

        const hindi = row.preferred_language !== null && row.preferred_language !== "EN";
        const token = row.token_number ? `\n🎟️ ${hindi ? "टोकन" : "Token"} ${row.token_number}` : "";

        const message = hindi
            ? `🔄 ${name}, ${doctorName} ${formatClockTime(was)} पर उपलब्ध नहीं हैं।\n\nआपका समय ${formatClockTime(replacement)} कर दिया गया है।${token}\n\nयदि यह ठीक न हो तो नीचे से बदलें या रद्द करें।`
            : `🔄 ${name}, ${doctorName} is unavailable at ${formatClockTime(was)}.\n\nYour appointment has been moved to ${formatClockTime(replacement)}.${token}\n\nIf that does not suit you, change or cancel it below.`;

        // Told first, moved second. A patient who cannot be reached is left
        // where they are: arriving to find their slot gone is worse than the
        // desk having to make a phone call.
        const outcomeOfSend = await sendProactive(client, String(row.patient_phone), message, null, {
            buttons: [
                { id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE, title: hindi ? "समय बदलें" : "Reschedule" },
                { id: BUTTON_IDS.PATIENT_MENU.CANCEL, title: hindi ? "रद्द करें" : "Cancel" }
            ]
        });

        if (!outcomeOfSend.delivered) {
            outcome.stranded.push({ appointmentId: row.id, patientName: name, at: formatClockTime(was), why: "unreachable" });
            continue;
        }

        const { error: moveError } = await supabase
            .from("appointments")
            .update({ appointment_time: replacement, updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("clinic_id", clinicId);

        if (moveError) {
            debug("breaks", "Told the patient and then could not move them", {
                appointmentId: row.id,
                error: moveError.message
            });

            outcome.stranded.push({ appointmentId: row.id, patientName: name, at: formatClockTime(was), why: "no_slot" });
            continue;
        }

        taken.add(replacement);
        outcome.moved.push({
            appointmentId: row.id,
            patientName: name,
            from: formatClockTime(was),
            to: formatClockTime(replacement)
        });
    }

    return outcome;
}
