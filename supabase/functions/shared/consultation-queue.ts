/**
 * Who is being seen, who is next, and whether the next one has been told.
 *
 * A waiting room runs on a number called out loud. The token already exists —
 * sequential per doctor per day, and deliberately never renumbered — but
 * nothing has ever known which token is *currently* inside the room. An
 * appointment goes straight from CONFIRMED to COMPLETED, so between those two
 * states the database is silent about the one thing the front desk is asked
 * about all day.
 *
 * Rather than add a third status and a tap to set it, the position is read
 * from what the doctor already does. Completions accumulate from the top of
 * the list, so the first appointment still CONFIRMED is the one being seen and
 * the second is next. Marking token 6 done moves the whole queue up by one
 * without anybody recording that token 7 went in.
 *
 * The cost of inferring rather than recording is that being seen out of order
 * reads wrong until the skipped patient is marked one way or the other. That
 * is the trade: no extra tap per patient, and a board that is occasionally
 * behind rather than a board that freezes whenever somebody forgets.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { getClinicRouteById } from "./clinic-routing.ts";
import { getClinicTimezone, todayInTimezone } from "./clinic-slots.ts";
import { formatClockTime } from "./appointment-format.ts";
import { sendProactive } from "./proactive.ts";
import { debug } from "./logger.ts";

/**
 * Long enough that a mis-tap can be taken back before the patient's phone
 * buzzes, short enough to still be the gap between one patient leaving and the
 * next walking in. Nothing is sent during it; the queue is read again when it
 * expires, so an undone completion simply never produces a message.
 */
export const CHANGEOVER_MS = 20_000;

export interface QueueEntry {
    appointmentId: string;
    token: number | null;
    patientName: string;
    time: string;
    phone: string;
    notified: boolean;
}

export interface DoctorQueue {
    doctorId: string;
    doctorName: string;
    nowSeeing: QueueEntry | null;
    next: QueueEntry | null;
    waiting: number;
    seen: number;
    /** False before the first patient of the day has been marked either way. */
    started: boolean;
}

interface Row {
    id: string;
    doctor_id: string | null;
    patient_name: string | null;
    patient_phone: string | null;
    appointment_time: string;
    token_number: number | null;
    status: string;
    preferred_language: string | null;
    next_up_notified_at: string | null;
}

/**
 * Two visits at the same minute are common, so the tie is broken on the token
 * rather than left to whatever order the database happened to return. The
 * portal's day view sorts the same way; a board that disagreed with the list
 * beside it would be worse than no board.
 */
function byTimeThenToken(a: Row, b: Row): number {
    const byTime = String(a.appointment_time).localeCompare(String(b.appointment_time));

    if (byTime !== 0) {
        return byTime;
    }

    return (a.token_number ?? Number.MAX_SAFE_INTEGER) - (b.token_number ?? Number.MAX_SAFE_INTEGER);
}

function toEntry(row: Row): QueueEntry {
    return {
        appointmentId: row.id,
        token: row.token_number ?? null,
        patientName: String(row.patient_name ?? "Patient"),
        time: formatClockTime(String(row.appointment_time)),
        phone: String(row.patient_phone ?? ""),
        notified: row.next_up_notified_at !== null
    };
}

async function todaysRows(
    supabase: SupabaseClient,
    clinicId: string,
    date: string,
    doctorId?: string
): Promise<Row[]> {
    let query = supabase
        .from("appointments")
        .select(
            "id, doctor_id, patient_name, patient_phone, appointment_time, token_number, status, preferred_language, next_up_notified_at"
        )
        .eq("clinic_id", clinicId)
        .eq("appointment_date", date)
        .neq("status", "CANCELLED");

    if (doctorId) {
        query = query.eq("doctor_id", doctorId);
    }

    const { data, error } = await query;

    if (error) {
        debug("queue", "Could not read the day", { clinicId, error: error.message });
        return [];
    }

    // A service with nobody assigned has no queue to stand in, and gets no
    // token, so it has no place on a board organised by doctor.
    return (data ?? []).filter((row: Row) => row.doctor_id !== null).sort(byTimeThenToken);
}

/** The board. One row per doctor who has anybody booked today. */
export async function readConsultationQueue(
    supabase: SupabaseClient,
    clinicId: string,
    date?: string
): Promise<{ date: string; doctors: DoctorQueue[] }> {
    const timezone = await getClinicTimezone(supabase, clinicId);
    const day = date ?? todayInTimezone(timezone);

    const rows = await todaysRows(supabase, clinicId, day);

    if (rows.length === 0) {
        return { date: day, doctors: [] };
    }

    const { data: doctorRows } = await supabase
        .from("doctors")
        .select("id, name")
        .eq("clinic_id", clinicId);

    const names = new Map<string, string>(
        (doctorRows ?? []).map((d: { id: string; name: string }) => [d.id, d.name])
    );

    const byDoctor = new Map<string, Row[]>();

    for (const row of rows) {
        const list = byDoctor.get(row.doctor_id!) ?? [];
        list.push(row);
        byDoctor.set(row.doctor_id!, list);
    }

    const doctors: DoctorQueue[] = [];

    for (const [doctorId, list] of byDoctor) {
        const stillWaiting = list.filter((r) => r.status === "CONFIRMED");
        const seen = list.length - stillWaiting.length;

        doctors.push({
            doctorId,
            doctorName: names.get(doctorId) ?? "Doctor",
            nowSeeing: stillWaiting[0] ? toEntry(stillWaiting[0]) : null,
            next: stillWaiting[1] ? toEntry(stillWaiting[1]) : null,
            // Those behind the two already named.
            waiting: Math.max(stillWaiting.length - 2, 0),
            seen,
            started: seen > 0
        });
    }

    doctors.sort((a, b) => a.doctorName.localeCompare(b.doctorName));

    return { date: day, doctors };
}

export interface NextUpResult {
    /** Null when the queue is empty or the person up next was already told. */
    appointmentId: string | null;
    delivered: boolean;
    reason?: "nobody_waiting" | "already_told" | "no_credentials" | "unreachable";
}

/**
 * Tell whoever is now at the front of the queue that it is their turn.
 *
 * Read fresh rather than passed in. If the completion that triggered this was
 * undone in the meantime, that patient is CONFIRMED again and back at the
 * front of the queue with their notice already sent, so nothing is sent and
 * the person behind them is not called in early. The re-read is the safety;
 * there is no separate undo to handle.
 */
export async function notifyNextUp(
    supabase: SupabaseClient,
    clinicId: string,
    doctorId: string,
    date?: string
): Promise<NextUpResult> {
    const timezone = await getClinicTimezone(supabase, clinicId);
    const day = date ?? todayInTimezone(timezone);

    const rows = await todaysRows(supabase, clinicId, day, doctorId);
    const upNext = rows.find((r) => r.status === "CONFIRMED");

    if (!upNext) {
        return { appointmentId: null, delivered: false, reason: "nobody_waiting" };
    }

    if (upNext.next_up_notified_at !== null) {
        return { appointmentId: upNext.id, delivered: false, reason: "already_told" };
    }

    const route = await getClinicRouteById(supabase, clinicId);

    if (!route) {
        debug("queue", "Clinic has no WhatsApp credentials", { clinicId });
        return { appointmentId: upNext.id, delivered: false, reason: "no_credentials" };
    }

    const { data: doctor } = await supabase
        .from("doctors")
        .select("name")
        .eq("id", doctorId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

    const doctorName = doctor?.name ? `Dr. ${doctor.name}` : "the doctor";
    const hindi = upNext.preferred_language !== null && upNext.preferred_language !== "EN";
    const token = upNext.token_number ? `\n🎟️ ${hindi ? "टोकन" : "Token"} ${upNext.token_number}` : "";
    const name = String(upNext.patient_name ?? (hindi ? "जी" : "there"));

    const message = hindi
        ? `🔔 ${name}, आपका नंबर अगला है।${token}\n\n🩺 ${doctorName}\n\nकृपया परामर्श कक्ष के पास पहुँच जाएँ।`
        : `🔔 ${name}, you're next.${token}\n\n🩺 ${doctorName}\n\nPlease make your way to the consultation room.`;

    const client = new WhatsAppClient(route.accessToken, route.phoneNumberId, supabase, clinicId);

    // No template. This is only useful in the seconds it is true, and a
    // template approved for it would still be delivered to a patient who had
    // already been called in by name, or gone home. Anyone Meta refuses is
    // shown as untold on the board instead, which is what the desk can act on.
    const outcome = await sendProactive(client, String(upNext.patient_phone), message, null);

    if (!outcome.delivered) {
        debug("queue", "Could not tell the next patient", {
            appointmentId: upNext.id,
            reason: outcome.reason
        });

        return { appointmentId: upNext.id, delivered: false, reason: "unreachable" };
    }

    await supabase
        .from("appointments")
        .update({ next_up_notified_at: new Date().toISOString() })
        .eq("id", upNext.id)
        .eq("clinic_id", clinicId);

    return { appointmentId: upNext.id, delivered: true };
}

/**
 * Called when a consultation ends, from each of the three places that can end
 * one. Returns immediately: the webhook has to answer Meta inside its timeout,
 * and a receptionist tapping Completed should not wait twenty seconds for the
 * page to come back.
 *
 * Best effort by design. If the instance is recycled before the timer fires
 * the message is lost, and the board still shows that patient as untold, which
 * is the same thing it shows when Meta refuses the send.
 */
export function scheduleNextUpNotice(
    supabase: SupabaseClient,
    clinicId: string,
    doctorId: string | null,
    delayMs: number = CHANGEOVER_MS
): void {
    if (!doctorId) {
        return;
    }

    const work = new Promise<void>((resolve) => {
        setTimeout(() => {
            notifyNextUp(supabase, clinicId, doctorId)
                .catch((error) => {
                    debug("queue", "Next-up notice failed", {
                        clinicId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                })
                .finally(resolve);
        }, delayMs);
    });

    // Supabase keeps a function alive for a registered background task; without
    // this the instance may be torn down the moment the response is written and
    // the timer never fires.
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
        .EdgeRuntime;

    if (runtime?.waitUntil) {
        runtime.waitUntil(work);
    }
}
