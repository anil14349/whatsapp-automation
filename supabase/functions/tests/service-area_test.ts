/**
 * How far away a patient is, and whether that is too far.
 *
 * Home collection accepted a location pin dropped anywhere on earth: the
 * coordinates were read off the message, written to the request, and never
 * measured against anything. These cover the check that replaced that, and in
 * particular the two ways it deliberately says yes — no clinic coordinates and
 * no radius — because an over-eager version would refuse every patient at a
 * clinic that has not filled the fields in yet.
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { checkServiceArea, distanceKm } from "../shared/geo.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";

const CLINIC = "402ae46c-56ed-40b0-a4b0-df63d6b43acc";

// Bangalore landmarks, roughly 3.3 km apart.
const CLINIC_LAT = 12.9716;
const CLINIC_LON = 77.5946;
const NEARBY_LAT = 12.9916;
const NEARBY_LON = 77.6196;

// Chennai, ~290 km away.
const FAR_LAT = 13.0827;
const FAR_LON = 80.2707;

function clinicRow(extra: Record<string, unknown>) {
    return fakeSupabase({
        clinics: [{ id: CLINIC, name: "Wellsun", ...extra }]
    });
}

Deno.test("distance between two points is symmetric and zero for the same point", () => {
    assertEquals(Math.round(distanceKm(CLINIC_LAT, CLINIC_LON, CLINIC_LAT, CLINIC_LON)), 0);

    const there = distanceKm(CLINIC_LAT, CLINIC_LON, FAR_LAT, FAR_LON);
    const back = distanceKm(FAR_LAT, FAR_LON, CLINIC_LAT, CLINIC_LON);

    assertEquals(Math.round(there), Math.round(back));
});

Deno.test("a known distance is right to within a kilometre", () => {
    // Bangalore to Chennai is about 290 km as the crow flies.
    const km = distanceKm(CLINIC_LAT, CLINIC_LON, FAR_LAT, FAR_LON);

    assertEquals(km > 285 && km < 295, true, `expected ~290 km, got ${km}`);
});

Deno.test("a location inside the radius is servable", async () => {
    const supabase = clinicRow({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    const result = await checkServiceArea(supabase as any, CLINIC, NEARBY_LAT, NEARBY_LON);

    assertEquals(result.servable, true);
    assertEquals(result.radiusKm, 10);
    assertEquals((result.distanceKm ?? 0) < 10, true);
});

Deno.test("a location outside the radius is refused and reports the distance", async () => {
    const supabase = clinicRow({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    const result = await checkServiceArea(supabase as any, CLINIC, FAR_LAT, FAR_LON);

    assertEquals(result.servable, false);
    assertEquals(result.radiusKm, 10);
    assertEquals(Math.round(result.distanceKm ?? 0) > 200, true);
});

Deno.test("the edge of the radius is inside it", async () => {
    const supabase = clinicRow({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    const away = distanceKm(CLINIC_LAT, CLINIC_LON, NEARBY_LAT, NEARBY_LON);
    const exact = clinicRow({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: Math.round(away * 1000) / 1000
    });

    const result = await checkServiceArea(exact as any, CLINIC, NEARBY_LAT, NEARBY_LON);

    assertEquals(result.servable, true, "a patient exactly on the boundary is inside it");
    assertEquals((await checkServiceArea(supabase as any, CLINIC, NEARBY_LAT, NEARBY_LON)).servable, true);
});

Deno.test("a clinic with no coordinates accepts every location", async () => {
    const supabase = clinicRow({
        latitude: null,
        longitude: null,
        home_collection_radius_km: 10
    });

    const result = await checkServiceArea(supabase as any, CLINIC, FAR_LAT, FAR_LON);

    assertEquals(result.servable, true);
    assertEquals(result.distanceKm, undefined, "there is nothing to measure from");
});

Deno.test("a clinic with no radius accepts every location but still reports the distance", async () => {
    const supabase = clinicRow({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: null
    });

    const result = await checkServiceArea(supabase as any, CLINIC, FAR_LAT, FAR_LON);

    assertEquals(result.servable, true);
    assertEquals(Math.round(result.distanceKm ?? 0) > 200, true);
});

Deno.test("a clinic that cannot be read accepts the location rather than refusing everyone", async () => {
    const supabase = fakeSupabase({ clinics: [] });

    const result = await checkServiceArea(supabase as any, CLINIC, FAR_LAT, FAR_LON);

    assertEquals(result.servable, true);
});

Deno.test("numeric columns arriving as strings are still compared as numbers", async () => {
    // PostgREST returns NUMERIC as a string often enough that a plain > would
    // silently compare "290.4" with 10 as text.
    const supabase = clinicRow({
        latitude: String(CLINIC_LAT),
        longitude: String(CLINIC_LON),
        home_collection_radius_km: "10"
    });

    const result = await checkServiceArea(supabase as any, CLINIC, FAR_LAT, FAR_LON);

    assertEquals(result.servable, false);
});
