/**
 * A doctor visiting the patient at home.
 *
 * Everything for this existed except the parts that make it happen: the hours
 * table had no writer, the location buttons were declared and never sent, and
 * nothing ever asked the patient where they wanted to be seen.
 *
 * The casing matters more than it looks. Slot generation compares against
 * "HOME", while the patient flow wrote "clinic" in lower case. A home visit
 * spelt in lower case would have been filled from the doctor's clinic hours —
 * a booking that looks right and is not.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, textMessage, tap, location, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { asLocationType, isHomeVisit, LOCATION_CLINIC, LOCATION_HOME } from "../shared/location-type.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

const CLINIC_LAT = 28.6139;
const CLINIC_LON = 77.2090;
const NEARBY_LAT = 28.6304;
const NEARBY_LON = 77.2177;
const FAR_LAT = 13.0827;
const FAR_LON = 80.2707;

function build(clinicOverrides: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());
    Object.assign(supabase.store.clinics[0], {
        latitude: CLINIC_LAT,
        longitude: CLINIC_LON,
        home_collection_radius_km: 10,
        ...clinicOverrides
    });

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const send = async (state: string, payload: Record<string, unknown>, message: any) => {
        supabase.store.whatsapp_sessions = [
            { phone: PATIENT_PHONE, clinic_id: CLINIC_A, state, data: payload, role: "PATIENT" }
        ];

        await handler.handle(
            session(state, payload, CLINIC_A, PATIENT_PHONE, "PATIENT"),
            message
        );
    };

    const current = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    const said = () => wa.sent.map((m) => m.body).join("\n");

    return { supabase, wa, send, current, said };
}

Deno.test("the two spellings of a location settle on one", () => {
    // The receptionist wrote CLINIC, the patient flow wrote clinic, and slot
    // generation only ever recognised HOME.
    assertEquals(asLocationType("clinic"), LOCATION_CLINIC);
    assertEquals(asLocationType("CLINIC"), LOCATION_CLINIC);
    assertEquals(asLocationType("home"), LOCATION_HOME);
    assertEquals(asLocationType("HOME"), LOCATION_HOME);
    assertEquals(asLocationType(" Home "), LOCATION_HOME);
});

Deno.test("anything unrecognised is a clinic visit, not a home visit", () => {
    // Guessing wrong in this direction sends a doctor to an address that was
    // never given.
    assertEquals(asLocationType(undefined), LOCATION_CLINIC);
    assertEquals(asLocationType(null), LOCATION_CLINIC);
    assertEquals(asLocationType(""), LOCATION_CLINIC);
    assertEquals(asLocationType("somewhere else"), LOCATION_CLINIC);
    assertEquals(isHomeVisit("nonsense"), false);
});

Deno.test("choosing the clinic carries on to the doctor", async () => {
    const { send, current } = build();

    await send(
        "BOOK_LOCATION",
        { language: "EN", serviceName: "Doctor Consultation", requiresDoctor: true },
        tap(BUTTON_IDS.LOCATION_TYPE.CLINIC)
    );

    assertEquals(current()?.state, "BOOK_DOCTOR");
    assertEquals(current()?.data?.locationType, LOCATION_CLINIC);
});

Deno.test("choosing home asks where to come", async () => {
    const { send, current, said } = build();

    await send(
        "BOOK_LOCATION",
        { language: "EN", serviceName: "Doctor Consultation", requiresDoctor: true },
        tap(BUTTON_IDS.LOCATION_TYPE.HOME)
    );

    assertEquals(current()?.state, "BOOK_ADDRESS");
    assertEquals(current()?.data?.locationType, LOCATION_HOME);
    assert(/Where should the doctor come/i.test(said()), said());
});

Deno.test("typing instead of tapping re-asks rather than guessing", async () => {
    const { send, current, said } = build();

    await send(
        "BOOK_LOCATION",
        { language: "EN", serviceName: "Doctor Consultation", requiresDoctor: true },
        textMessage("yes please")
    );

    assertEquals(current()?.state, "BOOK_LOCATION");
    assert(/Where would you like this/i.test(said()), said());
});

Deno.test("a stale button from another step does not choose a location", async () => {
    const { send, current } = build();

    await send(
        "BOOK_LOCATION",
        { language: "EN", serviceName: "Doctor Consultation", requiresDoctor: true },
        tap(BUTTON_IDS.DATE_SELECT.TODAY)
    );

    assertEquals(current()?.state, "BOOK_LOCATION");
});

Deno.test("an address within the radius is accepted and kept", async () => {
    const { send, current } = build();

    await send(
        "BOOK_ADDRESS",
        { language: "EN", requiresDoctor: true, locationType: LOCATION_HOME },
        location(NEARBY_LAT, NEARBY_LON, PATIENT_PHONE)
    );

    assertEquals(current()?.state, "BOOK_DOCTOR");
    assertEquals(current()?.data?.serviceLatitude, NEARBY_LAT);
    assertEquals(current()?.data?.serviceLongitude, NEARBY_LON);
    assertEquals(current()?.data?.locationType, LOCATION_HOME);
});

Deno.test("an address beyond the radius is refused and does not move on", async () => {
    const { send, current, said } = build();

    await send(
        "BOOK_ADDRESS",
        { language: "EN", requiresDoctor: true, locationType: LOCATION_HOME },
        location(FAR_LAT, FAR_LON, PATIENT_PHONE)
    );

    assertEquals(current()?.state, "BOOK_ADDRESS");
    assert(/outside the area we visit/i.test(said()), said());
});

Deno.test("a typed address is accepted when it is long enough to find", async () => {
    const { send, current } = build();

    await send(
        "BOOK_ADDRESS",
        { language: "EN", requiresDoctor: true, locationType: LOCATION_HOME },
        textMessage("14 Rajpath, opposite the post office, New Delhi")
    );

    assertEquals(current()?.state, "BOOK_DOCTOR");
    assertEquals(
        current()?.data?.serviceAddress,
        "14 Rajpath, opposite the post office, New Delhi"
    );
});

Deno.test("a scrap of an address is not enough to send a doctor to", async () => {
    const { send, current, said } = build();

    await send(
        "BOOK_ADDRESS",
        { language: "EN", requiresDoctor: true, locationType: LOCATION_HOME },
        textMessage("home")
    );

    assertEquals(current()?.state, "BOOK_ADDRESS");
    assert(/full address/i.test(said()), said());
});

Deno.test("a clinic that has set no radius still accepts a far address", async () => {
    const { send, current } = build({
        latitude: null,
        longitude: null,
        home_collection_radius_km: null
    });

    await send(
        "BOOK_ADDRESS",
        { language: "EN", requiresDoctor: true, locationType: LOCATION_HOME },
        location(FAR_LAT, FAR_LON, PATIENT_PHONE)
    );

    assertEquals(
        current()?.state,
        "BOOK_DOCTOR",
        "an unconfigured clinic must not refuse everyone"
    );
});
