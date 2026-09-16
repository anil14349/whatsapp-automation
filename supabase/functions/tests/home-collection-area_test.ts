/**
 * Home collection refuses a location it cannot reach.
 *
 * The unit tests in service-area_test.ts cover the arithmetic. These cover the
 * wiring, which is where this repo's bugs actually live: a check that computes
 * the right answer and is never called reads exactly like no check at all.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, location, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { HomeCollectionHandler } = await import("../shared/handlers/home-collection-handler.ts");

const CLINIC_LAT = 12.9716;
const CLINIC_LON = 77.5946;
const NEARBY_LAT = 12.9916;
const NEARBY_LON = 77.6196;
const CHENNAI_LAT = 13.0827;
const CHENNAI_LON = 80.2707;

function build(clinicOverrides: Record<string, unknown>) {
    const supabase = fakeSupabase(seed());
    Object.assign(supabase.store.clinics[0], clinicOverrides);

    const wa = new FakeWhatsAppClient();
    const handler = new HomeCollectionHandler(supabase, wa);
    (handler as any).supabaseClient.supabase = supabase;

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state: "LOCATION_SELECT",
            data: {},
            role: "PATIENT"
        }
    ];

    const share = async (lat: number, lon: number) => {
        const sess = session("LOCATION_SELECT", {}, CLINIC_A, PATIENT_PHONE, "PATIENT");
        await handler.handle(sess, location(lat, lon, PATIENT_PHONE));
    };

    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    return { supabase, wa, share, current };
}

Deno.test("a location beyond the radius is refused and the flow does not move on", async () => {
    const { wa, share, current } = build({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    await share(CHENNAI_LAT, CHENNAI_LON);

    const sent = wa.sent.map((m) => m.body).join("\n");

    assert(
        /outside our home collection area/i.test(sent),
        `expected a refusal, got: ${sent}`
    );
    assert(/\d+ km away/.test(sent), "the refusal should say how far away it is");
    assertEquals(
        current()?.state,
        "LOCATION_SELECT",
        "a refused location must not advance to LOCATION_VERIFY"
    );
});

Deno.test("a location inside the radius carries on to confirmation", async () => {
    const { wa, share, current } = build({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    await share(NEARBY_LAT, NEARBY_LON);

    const sent = wa.sent.map((m) => m.body).join("\n");

    assert(/Location received/i.test(sent), `expected the normal reply, got: ${sent}`);
    assertEquals(current()?.state, "LOCATION_VERIFY");
});

Deno.test("a clinic that has not set its location still accepts a far away patient", async () => {
    const { share, current } = build({
        latitude: null,
        longitude: null,
        home_collection_radius_km: null
    });

    await share(CHENNAI_LAT, CHENNAI_LON);

    assertEquals(
        current()?.state,
        "LOCATION_VERIFY",
        "an unconfigured clinic must keep today's behaviour rather than refusing everyone"
    );
});
