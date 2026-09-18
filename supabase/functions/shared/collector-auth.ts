/**
 * Collector sign-in.
 *
 * A collector used to be identified by their phone number and nothing else:
 * match an active row in `sample_collectors` and the round opened. The round
 * lists, for every home visit that day, the patient's name, their appointment
 * time and their home address, so a borrowed handset, a recycled number or a
 * SIM swap got a list of who is home and when. Doctors have never worked that
 * way.
 *
 * Counting and locking is shared with doctors. Only finding the account and
 * checking the PIN is collector-specific.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PIN_CONFIG } from "./config.ts";
import { hashPassword, verifyPassword, validatePinStrength } from "./bcrypt-password.ts";
import { debug } from "./logger.ts";
import {
    attemptsRemaining,
    clearFailures,
    isLockedOut,
    lockoutMinutesRemaining,
    recordFailure
} from "./login-attempts.ts";

export interface CollectorAccount {
    id: string;
    name: string;
    hasPin: boolean;
}

/** The active collector on this number, if there is one. */
export async function findCollector(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<CollectorAccount | null> {
    try {
        const { data } = await supabase
            .from("sample_collectors")
            .select("id, name, pin_hash")
            .eq("clinic_id", clinicId)
            .eq("phone", phone.trim())
            .eq("is_active", true)
            .maybeSingle();

        if (!data) {
            return null;
        }

        return { id: data.id, name: data.name, hasPin: Boolean(data.pin_hash) };
    } catch (error) {
        debug("collectorAuth", "Lookup failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

export type CollectorAuthResult =
    | { outcome: "ok"; collectorId: string }
    | { outcome: "locked"; minutes: number }
    | { outcome: "wrong"; remaining: number }
    | { outcome: "unknown" };

export async function verifyCollectorPin(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string,
    providedPin: string
): Promise<CollectorAuthResult> {
    const collector = await findCollector(supabase, phone, clinicId);

    if (!collector) {
        return { outcome: "unknown" };
    }

    if (await isLockedOut(supabase, collector.id, "collector")) {
        return {
            outcome: "locked",
            minutes: await lockoutMinutesRemaining(supabase, collector.id, "collector")
        };
    }

    const pin = String(providedPin || "").trim();

    // Shape is checked before the hash so a typo costs an attempt in the same
    // way a wrong PIN does; anything else tells an attacker which is which.
    const wellFormed =
        pin.length >= PIN_CONFIG.PIN_LENGTH_MIN &&
        pin.length <= PIN_CONFIG.PIN_LENGTH_MAX &&
        /^\d+$/.test(pin);

    let valid = false;

    if (wellFormed) {
        const { data } = await supabase
            .from("sample_collectors")
            .select("pin_hash")
            .eq("id", collector.id)
            .maybeSingle();

        // No hash is not a free pass. A collector with none is sent to set one.
        valid = data?.pin_hash ? await verifyPassword(pin, data.pin_hash) : false;
    }

    if (!valid) {
        await recordFailure(supabase, collector.id, "collector", clinicId);

        if (await isLockedOut(supabase, collector.id, "collector")) {
            return {
                outcome: "locked",
                minutes: await lockoutMinutesRemaining(supabase, collector.id, "collector")
            };
        }

        return {
            outcome: "wrong",
            remaining: await attemptsRemaining(supabase, collector.id, "collector")
        };
    }

    await clearFailures(supabase, collector.id, "collector");

    return { outcome: "ok", collectorId: collector.id };
}

/**
 * Store a collector's first PIN, or a replacement.
 *
 * Refuses a weak one for the same reason doctors' PINs are refused: 1234 on a
 * number an attacker already guessed is not a second factor.
 */
export async function setCollectorPin(
    supabase: SupabaseClient,
    collectorId: string,
    pin: string
): Promise<{ ok: boolean; error?: string }> {
    const strength = validatePinStrength(pin);

    if (!strength.valid) {
        return { ok: false, error: strength.errors.join(" ") };
    }

    const { error } = await supabase
        .from("sample_collectors")
        .update({ pin_hash: await hashPassword(pin), updated_at: new Date().toISOString() })
        .eq("id", collectorId);

    if (error) {
        debug("collectorAuth", "Could not store PIN", { error: error.message });
        return { ok: false, error: "Could not save that PIN. Please try again." };
    }

    return { ok: true };
}
