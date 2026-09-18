/**
 * Failed sign-in attempts and lockout, for any kind of staff.
 *
 * This was doctor-only and keyed on a phone number. Collectors need exactly
 * the same behaviour, and a second copy of a lockout is the kind of thing that
 * drifts until one of them stops locking anything.
 *
 * State lives in `login_rate_limits` because edge isolates are recycled
 * between messages; an in-memory counter reset itself and the lockout never
 * actually triggered.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PIN_CONFIG } from "./config.ts";
import { debug } from "./logger.ts";

/** Matches `login_rate_limits.user_type`. */
export type StaffKind = "doctor" | "collector" | "receptionist";

interface Attempt {
    count: number;
    lockedUntil: Date | null;
}

/**
 * Nothing is cached between calls.
 *
 * There was a per-isolate cache keyed on the phone number. Keyed on the
 * account id instead - which is what this is now - it outlived the thing it
 * described, and a lockout reading a stale count is worse than the two reads
 * it saved. Kept as an export because callers clear it between cases.
 */
export function clearAttemptCache(): void {
    // No state to clear.
}

async function load(
    supabase: SupabaseClient,
    userId: string,
    kind: StaffKind
): Promise<Attempt> {
    const attempt: Attempt = { count: 0, lockedUntil: null };

    try {
        const { data } = await supabase
            .from("login_rate_limits")
            .select("failed_attempts, locked_until")
            .eq("user_id", userId)
            .eq("user_type", kind)
            .maybeSingle();

        if (data) {
            attempt.count = data.failed_attempts ?? 0;

            if (data.locked_until) {
                const until = new Date(data.locked_until);

                if (until > new Date()) {
                    attempt.lockedUntil = until;
                } else {
                    // Lockout expired; the counter starts again.
                    attempt.count = 0;
                }
            }
        }
    } catch (error) {
        debug("loginAttempts", "Could not read attempt state", {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    return attempt;
}

export async function isLockedOut(
    supabase: SupabaseClient,
    userId: string,
    kind: StaffKind
): Promise<boolean> {
    const attempt = await load(supabase, userId, kind);
    return attempt.lockedUntil !== null && attempt.lockedUntil > new Date();
}

export async function attemptsRemaining(
    supabase: SupabaseClient,
    userId: string,
    kind: StaffKind
): Promise<number> {
    const attempt = await load(supabase, userId, kind);
    return Math.max(0, PIN_CONFIG.MAX_ATTEMPTS - attempt.count);
}

export async function lockoutMinutesRemaining(
    supabase: SupabaseClient,
    userId: string,
    kind: StaffKind
): Promise<number> {
    const attempt = await load(supabase, userId, kind);

    if (!attempt.lockedUntil) {
        return 0;
    }

    const ms = attempt.lockedUntil.getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

export async function recordFailure(
    supabase: SupabaseClient,
    userId: string,
    kind: StaffKind,
    clinicId: string
): Promise<void> {
    const attempt = await load(supabase, userId, kind);

    attempt.count += 1;

    if (attempt.count >= PIN_CONFIG.MAX_ATTEMPTS) {
        attempt.lockedUntil = new Date(Date.now() + PIN_CONFIG.LOCKOUT_MINUTES * 60 * 1000);

        debug("loginAttempts", "Account locked", { kind, attempts: attempt.count });
    }

    try {
        const row = {
            failed_attempts: attempt.count,
            last_failed_at: new Date().toISOString(),
            locked_until: attempt.lockedUntil?.toISOString() ?? null
        };

        // login_rate_limits has no unique index on (user_id, user_type), so an
        // upsert with onConflict would be rejected by Postgres.
        const { data: existing } = await supabase
            .from("login_rate_limits")
            .select("id")
            .eq("user_id", userId)
            .eq("user_type", kind)
            .maybeSingle();

        if (existing) {
            await supabase
                .from("login_rate_limits")
                .update(row)
                .eq("user_id", userId)
                .eq("user_type", kind);
        } else {
            await supabase
                .from("login_rate_limits")
                .insert({ user_id: userId, user_type: kind, clinic_id: clinicId, ...row });
        }
    } catch (error) {
        debug("loginAttempts", "Could not persist failed attempt", {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

export async function clearFailures(
    supabase: SupabaseClient,
    userId: string,
    kind: StaffKind
): Promise<void> {
    try {
        await supabase
            .from("login_rate_limits")
            .update({
                failed_attempts: 0,
                locked_until: null,
                updated_at: new Date().toISOString()
            })
            .eq("user_id", userId)
            .eq("user_type", kind);
    } catch (error) {
        debug("loginAttempts", "Could not clear failed attempts", {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
