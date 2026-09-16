/**
 * Is the person behind this token still allowed in?
 *
 * Deactivating someone on the Staff screen only stopped them signing in again.
 * Their existing token kept working, so "Deactivate" did nothing at all to
 * whoever was already signed in — for up to the twelve hours a token lasts.
 * Deleting the row had the same hole.
 *
 * This is the account-level twin of `isClinicActive`, and for the same reason:
 * a check that only runs at login is not revocation.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";
import type { TokenPayload } from "./jwt-auth.ts";

// Matches the clinic check: short enough to make revocation feel immediate,
// long enough not to re-read the same row on every request.
const TTL_MS = 30_000;

const cache: Record<string, { active: boolean; expiresAt: number }> = {};

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

export function clearAccountActiveCache(): void {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
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

export async function isAccountActive(
  user: TokenPayload,
  injected?: SupabaseClient
): Promise<boolean> {
  const source = SOURCES[user.role];

  if (!source || !user.userId) {
    return true;
  }

  const key = `${source.table}:${user.userId}`;
  const hit = cache[key];

  if (hit && hit.expiresAt > Date.now()) {
    return hit.active;
  }

  const supabase = injected ?? serviceClient();

  if (!supabase) {
    return true;
  }

  const { data, error } = await supabase
    .from(source.table)
    .select(source.column)
    .eq("id", user.userId)
    .maybeSingle();

  if (error) {
    // Same trade as the clinic check: locking everyone out over one failed
    // query is worse than briefly honouring a token that should be dead.
    debug("accountStatus", "Active check failed, allowing the request", {
      userId: user.userId,
      role: user.role,
      error: error.message
    });
    return true;
  }

  // A missing row means the account was deleted, which is not a reason to let
  // the token carry on working.
  const active = data
    ? (data as unknown as Record<string, unknown>)[source.column] === source.activeValue
    : false;

  cache[key] = { active, expiresAt: Date.now() + TTL_MS };

  return active;
}
