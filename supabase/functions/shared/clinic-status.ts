/**
 * Is this clinic still allowed to be used?
 *
 * Deactivating a clinic previously did almost nothing: no auth path looked at
 * `clinics.is_active`, so its staff kept working normally until their tokens
 * expired. This is checked on every authenticated request rather than only at
 * login, so deactivation takes effect immediately.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

// Short enough that deactivation is effectively immediate, long enough that a
// busy clinic is not re-reading the same row on every request.
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

export function clearClinicActiveCache(): void {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
}

export async function isClinicActive(clinicId: string): Promise<boolean> {
  const hit = cache[clinicId];

  if (hit && hit.expiresAt > Date.now()) {
    return hit.active;
  }

  const supabase = serviceClient();

  if (!supabase) {
    return true;
  }

  const { data, error } = await supabase
    .from("clinics")
    .select("is_active")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    // Locking every clinic out because one query failed is worse than the risk
    // of briefly honouring a deactivated one.
    debug("clinicStatus", "Active check failed, allowing the request", {
      clinicId,
      error: error.message
    });
    return true;
  }

  const active = data ? data.is_active !== false : false;

  cache[clinicId] = { active, expiresAt: Date.now() + TTL_MS };

  return active;
}
