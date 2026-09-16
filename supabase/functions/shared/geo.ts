/**
 * Distance between two points, and whether a clinic will travel that far.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ServiceAreaCheck {
    /** False only when the clinic is configured AND the point is outside it. */
    servable: boolean;
    /** Present whenever the clinic has coordinates, so callers can show it. */
    distanceKm?: number;
    radiusKm?: number;
}

/**
 * Decide whether a location is close enough for a home visit.
 *
 * Returns servable for a clinic that has not set its coordinates or its
 * radius. Turning an unconfigured clinic into one that refuses every patient
 * would be a worse failure than the missing check it replaces.
 */
export async function checkServiceArea(
    supabase: SupabaseClient,
    clinicId: string,
    latitude: number,
    longitude: number
): Promise<ServiceAreaCheck> {
    const { data, error } = await supabase
        .from("clinics")
        .select("latitude, longitude, home_collection_radius_km")
        .eq("id", clinicId)
        .maybeSingle();

    if (error || !data) {
        debug("serviceArea", "Clinic lookup failed, allowing", { clinicId, error: error?.message });
        return { servable: true };
    }

    const clinicLat = data.latitude === null ? null : Number(data.latitude);
    const clinicLon = data.longitude === null ? null : Number(data.longitude);
    const radius = data.home_collection_radius_km === null
        ? null
        : Number(data.home_collection_radius_km);

    if (clinicLat === null || clinicLon === null || !Number.isFinite(clinicLat) || !Number.isFinite(clinicLon)) {
        return { servable: true };
    }

    const away = distanceKm(clinicLat, clinicLon, latitude, longitude);

    if (radius === null || !Number.isFinite(radius)) {
        return { servable: true, distanceKm: away };
    }

    return { servable: away <= radius, distanceKm: away, radiusKm: radius };
}
