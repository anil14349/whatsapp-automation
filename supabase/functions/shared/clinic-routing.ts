import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

/**
 * Clinic routing for the multi-tenant webhook.
 *
 * Each clinic runs its own Meta app and WhatsApp Business Account, so the
 * verify token, the inbound ?token= and the sending credentials all differ
 * per clinic. Everything is resolved from the request itself; the env vars
 * remain only as a fallback for the original single-clinic deployment.
 */

export interface ClinicRoute {
    clinicId: string;
    clinicName: string;
    phoneNumberId: string;
    accessToken: string;
}

interface CacheEntry {
    route: ClinicRoute | null;
    expiresAt: number;
}

// Warm isolates are reused, so cached credentials must expire.
const ROUTE_TTL_MS = 60_000;
const routeCache: Record<string, CacheEntry> = {};

function cached(key: string): ClinicRoute | null | undefined {
    const entry = routeCache[key];

    if (entry && entry.expiresAt > Date.now()) {
        return entry.route;
    }

    return undefined;
}

function remember(key: string, route: ClinicRoute | null): void {
    routeCache[key] = { route, expiresAt: Date.now() + ROUTE_TTL_MS };
}

/** Drop cached routes so a change to a clinic takes effect immediately. */
export function clearRouteCache(): void {
    for (const key of Object.keys(routeCache)) {
        delete routeCache[key];
    }
}

function toRoute(row: Record<string, any> | null): ClinicRoute | null {
    if (!row) {
        return null;
    }

    const accessToken = row.whatsapp_access_token || Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
    const phoneNumberId =
        row.whatsapp_phone_number_id || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

    if (!accessToken || !phoneNumberId) {
        debug("clinicRouting", "Clinic has no usable WhatsApp credentials", {
            clinicId: row.id
        });
        return null;
    }

    return {
        clinicId: row.id,
        clinicName: row.name || "the clinic",
        phoneNumberId,
        accessToken
    };
}

/**
 * Credentials from the environment, used when the database cannot answer
 * (columns not migrated yet, transient error, or a single-clinic install).
 */
function envRoute(): ClinicRoute | null {
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
    const clinicId = Deno.env.get("DEFAULT_CLINIC_ID") || "";

    if (!accessToken || !phoneNumberId || !clinicId) {
        return null;
    }

    return { clinicId, clinicName: "the clinic", phoneNumberId, accessToken };
}

/**
 * Resolve the clinic that owns the WhatsApp number a message arrived on.
 * Falls back to DEFAULT_CLINIC_ID so an existing single-clinic setup keeps working.
 */
export async function getClinicByPhoneNumberId(
    supabase: SupabaseClient,
    phoneNumberId: string
): Promise<ClinicRoute | null> {
    const key = `phone:${phoneNumberId}`;
    const hit = cached(key);

    if (hit !== undefined) {
        return hit;
    }

    let route: ClinicRoute | null = null;

    if (phoneNumberId) {
        const { data, error } = await supabase
            .from("clinics")
            .select("id, name, whatsapp_phone_number_id, whatsapp_access_token, is_active")
            .eq("whatsapp_phone_number_id", phoneNumberId)
            .maybeSingle();

        if (error) {
            // Never take the bot offline because routing could not be read.
            debug("clinicRouting", "Clinic lookup failed, using env credentials", {
                phoneNumberId,
                error: error.message
            });

            const fallback = envRoute();
            remember(key, fallback);
            return fallback;
        }

        // A known but deactivated clinic must go silent, not fall through to the
        // default clinic, which would serve its patients under another tenant.
        if (data && data.is_active === false) {
            debug("clinicRouting", "Clinic is deactivated, refusing to route", {
                phoneNumberId,
                clinicId: data.id
            });

            remember(key, null);
            return null;
        }

        route = toRoute(data);
    }

    if (!route) {
        route = await getDefaultClinic(supabase);

        if (route) {
            debug("clinicRouting", "Falling back to default clinic", { phoneNumberId });
        }
    }

    remember(key, route);
    return route;
}

async function getDefaultClinic(supabase: SupabaseClient): Promise<ClinicRoute | null> {
    const defaultId = Deno.env.get("DEFAULT_CLINIC_ID");

    if (!defaultId) {
        return null;
    }

    const { data, error } = await supabase
        .from("clinics")
        .select("id, name, whatsapp_phone_number_id, whatsapp_access_token, is_active")
        .eq("id", defaultId)
        .maybeSingle();

    if (error) {
        return envRoute();
    }

    if (data && data.is_active === false) {
        return null;
    }

    return toRoute(data) || envRoute();
}

/**
 * Sending credentials for one clinic.
 *
 * Used where the clinic is already known from an authenticated request rather
 * than resolved from an inbound message.
 */
export async function getClinicRouteById(
    supabase: SupabaseClient,
    clinicId: string
): Promise<ClinicRoute | null> {
    const key = `id:${clinicId}`;
    const hit = cached(key);

    if (hit !== undefined) {
        return hit;
    }

    const { data, error } = await supabase
        .from("clinics")
        .select("id, name, whatsapp_phone_number_id, whatsapp_access_token")
        .eq("id", clinicId)
        .maybeSingle();

    const route = error ? envRoute() : toRoute(data);

    remember(key, route);
    return route;
}

/**
 * Every active clinic with usable sending credentials.
 *
 * Used by the scheduler, which has no inbound message to route from and must
 * send each clinic's reminders from that clinic's own number.
 */
export async function getActiveClinicRoutes(
    supabase: SupabaseClient
): Promise<ClinicRoute[]> {
    const { data, error } = await supabase
        .from("clinics")
        .select("id, name, whatsapp_phone_number_id, whatsapp_access_token")
        .eq("is_active", true);

    if (error) {
        debug("clinicRouting", "Active clinic lookup failed, using env credentials", {
            error: error.message
        });

        const fallback = envRoute();
        return fallback ? [fallback] : [];
    }

    const routes: ClinicRoute[] = [];

    for (const row of data || []) {
        const route = toRoute(row);

        if (route) {
            routes.push(route);
        }
    }

    return routes;
}

/**
 * True when the token matches any clinic's verify token, or the env fallback.
 * Used only for the Meta subscription handshake.
 */
export async function isValidVerifyToken(
    supabase: SupabaseClient,
    token: string
): Promise<boolean> {
    if (!token) {
        return false;
    }

    if (token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
        return true;
    }

    const { data, error } = await supabase
        .from("clinics")
        .select("id")
        .eq("whatsapp_verify_token", token)
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        return false;
    }

    return Boolean(data);
}

/**
 * Resolve which clinic a ?token= authorises.
 *
 * The token must be bound to its clinic: validating it globally would let any
 * clinic post messages into another clinic's tenant by supplying that clinic's
 * phone_number_id. Returns null when the token is not recognised.
 */
export async function getClinicIdByWebhookToken(
    supabase: SupabaseClient,
    token: string | null
): Promise<string | null> {
    if (!token) {
        return null;
    }

    const envToken = Deno.env.get("WHATSAPP_WEBHOOK_POST_TOKEN");

    // The legacy shared token only ever authorises the default clinic.
    if (envToken && token === envToken) {
        return Deno.env.get("DEFAULT_CLINIC_ID") || null;
    }

    const { data, error } = await supabase
        .from("clinics")
        .select("id")
        .eq("whatsapp_webhook_token", token)
        .eq("is_active", true)
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    return data.id;
}

/**
 * The Meta app secret for a clinic, used to verify the webhook signature.
 *
 * Null means this clinic has no secret configured and is still running on the
 * query token alone. The env value is the single-tenant fallback and only
 * applies to the default clinic, for the same reason the webhook token does.
 */
export async function getClinicAppSecret(
    supabase: SupabaseClient,
    clinicId: string
): Promise<string | null> {
    const { data, error } = await supabase
        .from("clinics")
        .select("whatsapp_app_secret")
        .eq("id", clinicId)
        .maybeSingle();

    if (!error && data?.whatsapp_app_secret) {
        return data.whatsapp_app_secret;
    }

    const envSecret = Deno.env.get("WHATSAPP_APP_SECRET");

    if (envSecret && clinicId === Deno.env.get("DEFAULT_CLINIC_ID")) {
        return envSecret;
    }

    return null;
}
