/**
 * What Meta says about a message after it has accepted it.
 *
 * A send call returning a message id means Meta took the message, not that
 * anyone received it. For an interactive message - which is what a reminder is,
 * because of its Cancel and Reschedule buttons - Meta accepts first and reports
 * 131047 afterwards, on the status webhook. Almost every reminder lands there:
 * it goes out long after the patient last wrote, so the 24 hour window is shut.
 *
 * The row said SENT, the fallback in sendProactive never ran because nothing
 * ever threw, and no reminder reached anyone outside the window.
 *
 * Proven on 2026-09-18 by booking on the test number, making the reminder due
 * and watching the scheduler mark it SENT while Meta's own callback recorded
 * `delivery: failed, 131047` against the very same message id.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface DeliveryError {
    code?: number;
    title?: string;
    detail?: string;
}

export function describeDeliveryErrors(errors: DeliveryError[] | undefined): string {
    return (
        errors
            ?.map((e) => e.detail ?? e.title)
            .filter(Boolean)
            .join("; ") || "WhatsApp could not deliver it"
    );
}

/**
 * Take a reminder back off SENT when Meta reports it never arrived.
 *
 * Sending the same free-form message again would fail identically, so the retry
 * is marked to go out as the approved template instead.
 */
export async function recordReminderDelivery(
    supabase: SupabaseClient,
    clinicId: string,
    messageId: string,
    deliveryStatus: string,
    errors: DeliveryError[] | undefined
): Promise<{ found: boolean; retrying: boolean }> {
    if (deliveryStatus !== "failed" || !messageId || !clinicId) {
        return { found: false, retrying: false };
    }

    const { data: reminder, error: findError } = await supabase
        .from("appointment_reminders")
        .select("id, attempts, max_attempts")
        // The report arrives with Meta's id and nothing else, and one WhatsApp
        // number can carry several clinics. Scoped so a report on one clinic's
        // webhook can never move another's reminder.
        .eq("clinic_id", clinicId)
        .eq("message_id", messageId)
        .eq("status", "SENT")
        .maybeSingle();

    if (findError || !reminder) {
        return { found: false, retrying: false };
    }

    // `attempts` already counts the send that has just failed.
    const retrying = (reminder.attempts ?? 0) < (reminder.max_attempts ?? 0);

    const { error } = await supabase
        .from("appointment_reminders")
        .update({
            status: retrying ? "PENDING" : "FAILED",
            error_message: describeDeliveryErrors(errors),
            // Due now, so the next pass picks it up rather than waiting for a
            // scheduled time that has already gone by.
            ...(retrying
                ? { scheduled_time: new Date().toISOString(), force_template: true }
                : {}),
            updated_at: new Date().toISOString()
        })
        .eq("id", reminder.id)
        .eq("clinic_id", clinicId)
        // Only if nothing else has moved it in the meantime.
        .eq("status", "SENT");

    if (error) {
        return { found: true, retrying: false };
    }

    return { found: true, retrying };
}
