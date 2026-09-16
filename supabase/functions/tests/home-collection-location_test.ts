/**
 * A shared location pin reaching the home collection flow.
 *
 * The processor built the handler's message as `{type:"text", text}` and
 * dropped latitude and longitude, so the handler's GPS branch could never run.
 * Attaching your location in WhatsApp produced "please share your location"
 * again, however many times you sent it, and the only way through was to type
 * an address. The patient route passed the coordinates; this one did not.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const CLINIC_LAT = 28.6139;
const CLINIC_LON = 77.2090;
const NEARBY_LAT = 28.6304;
const NEARBY_LON = 77.2177;
const CHENNAI_LAT = 13.0827;
const CHENNAI_LON = 80.2707;

function build(clinicOverrides: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());
    Object.assign(supabase.store.clinics[0], clinicOverrides);

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state: "LOCATION_SELECT",
            data: {},
            role: "PATIENT"
        }
    ];

    const wa = new FakeWhatsAppClient();

    const share = (latitude: number, longitude: number) =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: PATIENT_PHONE,
            senderName: "Sim",
            messageText: "",
            messageType: "location",
            latitude,
            longitude,
            clinicId: CLINIC_A
        });

    const state = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE)?.state;

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, share, state, said };
}

Deno.test("a shared pin is received instead of asking for it again", async () => {
    const { share, state, said } = build({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    await share(NEARBY_LAT, NEARBY_LON);

    assert(
        !/Please share your location/i.test(said()),
        `the pin was ignored and the prompt repeated: ${said()}`
    );
    assertEquals(state(), "LOCATION_VERIFY");
});

Deno.test("a pin outside the radius is refused once it can be read at all", async () => {
    const { share, state, said } = build({
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10
    });

    await share(CHENNAI_LAT, CHENNAI_LON);

    assert(/outside our home collection area/i.test(said()), said());
    assertEquals(state(), "LOCATION_SELECT");
});

Deno.test("a typed address still works", async () => {
    const supabase = fakeSupabase(seed());

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state: "LOCATION_SELECT",
            data: {},
            role: "PATIENT"
        }
    ];

    const wa = new FakeWhatsAppClient();

    await processMessage(supabase as any, wa as any, {
        messageId: crypto.randomUUID(),
        senderPhone: PATIENT_PHONE,
        senderName: "Sim",
        messageText: "14 Rajpath, New Delhi",
        messageType: "text",
        clinicId: CLINIC_A
    });

    assertEquals(
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE)?.state,
        "LOCATION_VERIFY"
    );
});
