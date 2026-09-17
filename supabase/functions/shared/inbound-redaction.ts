/**
 * Keeping credentials out of `whatsapp_log`.
 *
 * Every inbound message is recorded verbatim, which is right for a booking and
 * wrong for a PIN. A doctor signing in, changing their PIN or resetting it
 * types the PIN as an ordinary WhatsApp message, so it was being written to a
 * table in plain text and kept there — a live credential, not a temporary one.
 *
 * The state is what distinguishes a PIN from any other four to six digits, and
 * the shape is checked first so the extra read only happens for the handful of
 * messages that could be one. A patient sending a six digit postcode costs
 * nothing: the lookup finds they are not at a PIN prompt and it is logged as
 * usual.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const PIN_ENTRY_STATES = ["DOCTOR_LOGIN", "DOCTOR_CHANGE_PIN", "DOCTOR_RESET_PIN"];

export const WITHHELD = "[PIN withheld]";

/** Matches validatePinStrength: four to six digits and nothing else. */
const PIN_SHAPED = /^\d{4,6}$/;

export function couldBeAPin(messageType: string, text: string): boolean {
    // A button id is not a secret and is worth keeping in the log.
    return messageType === "text" && PIN_SHAPED.test(text.trim());
}

export async function redactCredentials(
    supabase: SupabaseClient,
    clinicId: string,
    phone: string,
    messageType: string,
    text: string
): Promise<string> {
    if (!couldBeAPin(messageType, text)) {
        return text;
    }

    // Scoped, because the same number can be a doctor at one clinic and a
    // patient at another: the unscoped read could find the wrong session and
    // log the PIN.
    const { data, error } = await supabase
        .from("whatsapp_sessions")
        .select("state")
        .eq("phone", phone)
        .eq("clinic_id", clinicId)
        .maybeSingle();

    // Failing closed here loses one log line and keeps a credential out of the
    // table, which is the right way round.
    if (error || PIN_ENTRY_STATES.includes(String(data?.state ?? ""))) {
        return WITHHELD;
    }

    return text;
}
