/**
 * Lunch, from the patient's side.
 *
 * The point of a break is that nobody is offered it. A doctor who eats between
 * one and two could previously only set ON_BREAK, which hid the entire day, so
 * the choice was an empty diary or patients arriving at a closed door.
 *
 * Driven through the real slot builder rather than the break reader, because
 * the reader returning the right rows proves nothing about what a patient is
 * shown.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { MultiClinicSupabaseClient } from "../shared/multi-clinic-supabase-client.ts";
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";
import { isoDayOfWeek } from "../shared/doctor-breaks.ts";

const IST = "Asia/Kolkata";

function clinicToday(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}

/** Tomorrow, so today's notice rules do not decide the answer. */
function nextDay(date: string): string {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function build(breaks: Record<string, unknown>[]) {
    const supabase = fakeSupabase(seed());
    const date = nextDay(clinicToday());

    supabase.store.clinics = [
        { id: CLINIC_A, name: "Clinic A", timezone: IST, enable_doctor_consultations: true }
    ];

    supabase.store.clinic_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        day_of_week: day,
        opening_time: "09:00",
        closing_time: "18:00",
        is_active: true
    }));

    supabase.store.doctor_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        day_of_week: day,
        opening_time: "09:00",
        closing_time: "18:00",
        is_active: true
    }));

    supabase.store.appointments = [];
    supabase.store.doctor_breaks = breaks;

    clearClinicServiceCache();
    clearClinicTimezoneCache();

    return { client: new MultiClinicSupabaseClient("", "", supabase as never), date };
}

Deno.test("lunch is not offered to patients", async () => {
    const { client, date } = build([
        {
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            day_of_week: isoDayOfWeek(nextDay(clinicToday())),
            start_time: "13:00",
            end_time: "14:00",
            reason: "Lunch"
        }
    ]);

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, date, "CLINIC");

    assert(!slots.includes("13:00"), `lunch was offered: ${slots.join(", ")}`);
    assert(!slots.includes("13:30"), `lunch was offered: ${slots.join(", ")}`);

    // Either side of it is still bookable; a break is not a half day.
    assert(slots.includes("12:30"), "the slot before lunch went missing");
    assert(slots.includes("14:00"), "the slot lunch ends on went missing");
});

Deno.test("with no break the whole day is still offered", async () => {
    // The control. Without it the test above passes for a doctor with no
    // hours at all.
    const { client, date } = build([]);

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, date, "CLINIC");

    assert(slots.includes("13:00"), `expected a full day, got: ${slots.join(", ")}`);
    assert(slots.includes("13:30"));
});

Deno.test("a break on another weekday does not touch this one", async () => {
    const date = nextDay(clinicToday());
    const otherDay = (isoDayOfWeek(date) % 7) + 1;

    const { client } = build([
        { clinic_id: CLINIC_A, doctor_id: DOCTOR_A, day_of_week: otherDay, start_time: "13:00", end_time: "14:00" }
    ]);

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, date, "CLINIC");

    assert(slots.includes("13:00"), "another day's lunch removed this day's slot");
});

Deno.test("an unplanned break clears its window for that date only", async () => {
    const date = nextDay(clinicToday());

    const { client } = build([
        { clinic_id: CLINIC_A, doctor_id: DOCTOR_A, on_date: date, start_time: "15:00", end_time: "16:00" }
    ]);

    const onTheDay = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, date, "CLINIC");
    const weekLater = await client.getAvailableSlots(
        CLINIC_A,
        DOCTOR_A,
        nextDay(nextDay(nextDay(nextDay(nextDay(nextDay(nextDay(date))))))),
        "CLINIC"
    );

    assert(!onTheDay.includes("15:00"), "the break was offered anyway");
    assert(!onTheDay.includes("15:30"));
    assert(weekLater.includes("15:00"), "a one-off break came back the following week");
});

Deno.test("several breaks in a day all come out", async () => {
    const day = isoDayOfWeek(nextDay(clinicToday()));

    const { client, date } = build([
        { clinic_id: CLINIC_A, doctor_id: DOCTOR_A, day_of_week: day, start_time: "11:00", end_time: "11:30", reason: "Tea" },
        { clinic_id: CLINIC_A, doctor_id: DOCTOR_A, day_of_week: day, start_time: "13:00", end_time: "14:00", reason: "Lunch" }
    ]);

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, date, "CLINIC");

    assert(!slots.includes("11:00"));
    assert(!slots.includes("13:00"));
    assert(slots.includes("11:30"), "the slot after the tea break went missing");
});
