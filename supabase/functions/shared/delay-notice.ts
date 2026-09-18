/**
 * Telling waiting patients that a doctor is running late.
 *
 * Without this the clinic's only options are to say nothing, or to move every
 * appointment, which frees slots that are not really free and cascades into the
 * rest of the day. The booked time is therefore left alone; only the expected
 * time is communicated.
 *
 * Scoped to one doctor: a doctor overrunning has nothing to do with the
 * patients waiting for a different one.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { BUTTON_IDS } from "./button-ids.ts";
import { getClinicRouteById } from "./clinic-routing.ts";
import { getClinicTimezone, todayInTimezone } from "./clinic-slots.ts";
import { formatClockTime } from "./appointment-format.ts";
import { sendProactive } from "./proactive.ts";
import { debug } from "./logger.ts";

export interface DelayResult {
    notified: number;
    failed: number;
    affected: Array<{ time: string; expected: string; token: number | null; name: string }>;
}

function addMinutes(time: string, minutes: number): string {
    const [h, m] = time.slice(0, 5).split(":").map(Number);
    const total = (h || 0) * 60 + (m || 0) + minutes;

    // A delay past midnight is a different day's problem, so it stops at 23:59.
    const capped = Math.min(total, 23 * 60 + 59);

    return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`;
}

function nowInClinic(timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(new Date());

    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

    return `${part("hour")}:${part("minute")}`;
}

export async function notifyDelay(
    supabase: SupabaseClient,
    clinicId: string,
    doctorId: string,
    minutes: number,
    fromTime?: string
): Promise<DelayResult> {
    const timezone = await getClinicTimezone(supabase, clinicId);
    const today = todayInTimezone(timezone);

    // Anyone already seen is past caring, so only those still waiting are told.
    const cutoff = fromTime ?? nowInClinic(timezone);

    const { data: doctor } = await supabase
        .from("doctors")
        .select("name")
        .eq("id", doctorId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

    const { data: waiting, error } = await supabase
        .from("appointments")
        .select("id, patient_name, patient_phone, appointment_time, token_number, preferred_language")
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId)
        .eq("appointment_date", today)
        .eq("status", "CONFIRMED")
        .gte("appointment_time", cutoff)
        .order("appointment_time", { ascending: true });

    if (error) {
        debug("delay", "Could not list waiting patients", { clinicId, error: error.message });
        return { notified: 0, failed: 0, affected: [] };
    }

    const affected = (waiting ?? []).map((row) => ({
        name: String(row.patient_name ?? "Patient"),
        time: formatClockTime(String(row.appointment_time)),
        expected: formatClockTime(addMinutes(String(row.appointment_time), minutes)),
        token: row.token_number ?? null
    }));

    if (affected.length === 0) {
        return { notified: 0, failed: 0, affected };
    }

    const route = await getClinicRouteById(supabase, clinicId);

    if (!route) {
        debug("delay", "Clinic has no WhatsApp credentials", { clinicId });
        return { notified: 0, failed: affected.length, affected };
    }

    const client = new WhatsAppClient(
        route.accessToken,
        route.phoneNumberId,
        supabase,
        clinicId
    );

    // "Dr." and "11:30 am", matching every other message the patient gets.
    const doctorName = doctor?.name ? `Dr. ${doctor.name}` : "The doctor";

    let notified = 0;
    let failed = 0;

    for (const row of waiting ?? []) {
        const time = formatClockTime(String(row.appointment_time));
        const expected = formatClockTime(addMinutes(String(row.appointment_time), minutes));
        const token = row.token_number ? `\n🎟️ Token ${row.token_number}` : "";
        const hindi = row.preferred_language && row.preferred_language !== "EN";

        const message = hindi
            ? `⏳ ${doctorName} थोड़ा देर से चल रहे हैं (लगभग ${minutes} मिनट)।\n\nआपका ${time} का समय अब लगभग ${expected} बजे अपेक्षित है।${token}\n\nअसुविधा के लिए खेद है।`
            : `⏳ ${doctorName} is running about ${minutes} minutes late.\n\nYour ${time} appointment is now expected around ${expected}.${token}\n\nSorry for the wait.`;

        // A patient waiting at home has usually not messaged today, so the
        // free-form notice alone would be refused and they would sit waiting
        // for the original time.
        const outcome = await sendProactive(client, String(row.patient_phone), message, {
            key: "appointment_delay",
            language: row.preferred_language ?? "EN",
            parameters: [
                String(row.patient_name ?? "there"),
                doctorName,
                String(minutes),
                expected
            ]
        }, {
            // Being told the doctor is late is exactly when someone decides
            // they cannot wait, so the way out is offered with it.
            buttons: [
                {
                    id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE,
                    title: hindi ? "समय बदलें" : "Reschedule"
                },
                {
                    id: BUTTON_IDS.PATIENT_MENU.CANCEL,
                    title: hindi ? "रद्द करें" : "Cancel"
                }
            ]
        });

        if (outcome.delivered) {
            notified++;
        } else {
            // One unreachable patient must not stop the rest being told.
            failed++;
            debug("delay", "Could not notify patient", {
                appointmentId: row.id,
                reason: outcome.reason,
                error: outcome.error
            });
        }
    }

    return { notified, failed, affected };
}
