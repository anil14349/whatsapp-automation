/**
 * Is this request still allowed, in one round trip?
 *
 * Every authenticated request has to answer two questions: is the clinic still
 * active, and is the account still active. Asked separately they were two
 * queries, and measurement showed those two dominated the request - more time
 * than the work the endpoint was actually there to do.
 *
 * The account row already points at its clinic, so PostgREST can answer both
 * in one go. The answers and the fail-open behaviour are unchanged; only the
 * number of round trips is.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TokenPayload } from "./jwt-auth.ts";
import { debug } from "./logger.ts";

export interface AccessAnswer {
    clinicActive: boolean;
    accountActive: boolean;
}

/** Doctors carry a boolean; the other two carry a status string. */
const SOURCES: Record<
    TokenPayload["role"],
    { table: string; column: string; activeValue: unknown }
> = {
    DOCTOR: { table: "doctors", column: "is_active", activeValue: true },
    RECEPTIONIST: { table: "receptionists", column: "status", activeValue: "ACTIVE" },
    ADMIN: { table: "clinic_admins", column: "status", activeValue: "ACTIVE" },
    CLINIC_OWNER: { table: "clinic_admins", column: "status", activeValue: "ACTIVE" }
};

const TTL_MS = 30_000;

const cache: Record<string, { answer: AccessAnswer; expiresAt: number }> = {};

let client: SupabaseClient | null = null;

function serviceClient(): SupabaseClient | null {
    if (client) {
        return client;
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !key) {
        return null;
    }

    client = createClient(url, key);
    return client;
}

export function clearAccessCache(): void {
    for (const key of Object.keys(cache)) {
        delete cache[key];
    }
}

export async function checkAccess(
    user: TokenPayload,
    injected?: SupabaseClient
): Promise<AccessAnswer> {
    const source = SOURCES[user.role];

    // Nothing to look up, so nothing to refuse on.
    if (!source || !user.userId) {
        return { clinicActive: true, accountActive: true };
    }

    const key = `${source.table}:${user.userId}:${user.clinicId ?? "-"}`;
    const hit = cache[key];

    if (hit && hit.expiresAt > Date.now()) {
        return hit.answer;
    }

    const supabase = injected ?? serviceClient();

    if (!supabase) {
        return { clinicActive: true, accountActive: true };
    }

    // A platform ADMIN has no clinic of their own, so there is none to embed.
    const select = user.clinicId
        ? `${source.column}, clinic:clinics(is_active)`
        : source.column;

    const { data, error } = await supabase
        .from(source.table)
        .select(select)
        .eq("id", user.userId)
        .maybeSingle();

    if (error) {
        // Locking everyone out over one failed query is worse than briefly
        // honouring a token that should be dead.
        debug("accessCheck", "Check failed, allowing the request", {
            userId: user.userId,
            role: user.role,
            error: error.message
        });
        return { clinicActive: true, accountActive: true };
    }

    const row = data as unknown as Record<string, any> | null;

    // A missing row means the account was deleted, which is not a reason to
    // let the token carry on working.
    const accountActive = row ? row[source.column] === source.activeValue : false;

    const clinicActive = !user.clinicId
        ? true
        : row?.clinic
            ? row.clinic.is_active !== false
            : false;

    const answer = { clinicActive, accountActive };

    cache[key] = { answer, expiresAt: Date.now() + TTL_MS };

    return answer;
}
