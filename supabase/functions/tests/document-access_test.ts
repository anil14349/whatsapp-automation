/**
 * Whose documents a doctor may read.
 *
 * The list was scoped by clinic alone, and DOCTOR is one of the roles the
 * endpoint accepts, so any doctor could pass another doctor's patient's number
 * and read their reports back. The front desk is meant to see the whole
 * clinic; a doctor is not.
 *
 * ownedAppointmentIds is the function the endpoint itself calls. It lives in
 * shared/ so this can import it without starting the endpoint's listener.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { ownedAppointmentIds } from "../shared/document-access.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const OTHER_DOCTOR = "doctor-other";
const OTHER_PATIENT = "919000000777";

function build() {
    const supabase = fakeSupabase(seed());

    supabase.store.appointments = [
        {
            id: "APT_MINE",
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: PATIENT_PHONE,
            appointment_date: "2099-01-01",
            appointment_time: "10:00",
            status: "COMPLETED"
        },
        {
            id: "APT_THEIRS",
            clinic_id: CLINIC_A,
            doctor_id: OTHER_DOCTOR,
            patient_phone: OTHER_PATIENT,
            appointment_date: "2099-01-01",
            appointment_time: "11:00",
            status: "COMPLETED"
        }
    ];

    return supabase;
}

Deno.test("a doctor's own appointment is returned", async () => {
    // The control: without it the two refusals below would be satisfied by a
    // function that always answered with nothing.
    const ids = await ownedAppointmentIds(build() as any, CLINIC_A, DOCTOR_A, {});

    assertEquals(ids, ["APT_MINE"]);
});

Deno.test("asking by another doctor's patient's number returns nothing", async () => {
    const ids = await ownedAppointmentIds(build() as any, CLINIC_A, DOCTOR_A, {
        phone: OTHER_PATIENT
    });

    assertEquals(ids, [], "another doctor's appointment was matched");
});

Deno.test("naming another doctor's appointment directly returns nothing", async () => {
    const ids = await ownedAppointmentIds(build() as any, CLINIC_A, DOCTOR_A, {
        appointmentId: "APT_THEIRS"
    });

    assertEquals(ids, [], "another doctor's appointment was matched by id");
});

Deno.test("a formatted number still matches", async () => {
    // The column holds digits only, so this has to survive the way a person
    // types a number.
    const ids = await ownedAppointmentIds(build() as any, CLINIC_A, DOCTOR_A, {
        phone: `+${PATIENT_PHONE.slice(0, 2)} ${PATIENT_PHONE.slice(2)}`
    });

    assertEquals(ids, ["APT_MINE"]);
});

Deno.test("an empty list is distinguishable from a failed lookup", async () => {
    // The endpoint shows nothing for [] and answers 500 for null, so these
    // must not collapse into one another.
    const ids = await ownedAppointmentIds(build() as any, CLINIC_A, "nobody", {});

    assert(Array.isArray(ids), "a doctor with no appointments should get a list, not null");
    assertEquals(ids, []);
});
