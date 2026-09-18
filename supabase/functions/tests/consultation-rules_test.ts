/**
 * A consultation obeys the same per-service rules as everything else.
 *
 * There are two slot paths. `getClinicServiceSlots` serves anything without a
 * doctor and has honoured the service's notice period and time window since
 * they were wired. `getAvailableSlots` serves anything with one, and read no
 * `clinic_services` column at all - so "Least notice" set to 8 on a
 * consultation was accepted by the portal, displayed afterwards as 8, and
 * changed nothing about what patients were offered.
 *
 * Silence is the failure mode worth testing for: nothing errored, the setting
 * simply did not apply.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { MultiClinicSupabaseClient } from "../shared/multi-clinic-supabase-client.ts";
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";

const IST = "Asia/Kolkata";
const CONSULT = "t-consult";

const CONSULT_TYPE = {
    id: CONSULT,
    code: "CONSULTATION",
    name: "Doctor Consultation",
    category: "CONSULTATION",
    default_clinic_price: 500,
    default_home_price: 750,
    default_duration_minutes: 30,
    is_active: true
};

/** The clinic's own date, since the window is measured against it. */
function clinicToday(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}

function build(service: Record<string, unknown> = {}) {
    const supabase = fakeSupabase(seed());
    const date = clinicToday();

    supabase.store.clinics = [
        {
            id: CLINIC_A,
            name: "Clinic A",
            timezone: IST,
            enable_doctor_consultations: true,
            enable_diagnostic_center: true,
            enable_home_collection: true,
            enable_doctor_home_visits: true
        }
    ];

    supabase.store.clinic_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        day_of_week: day,
        opening_time: "00:00",
        closing_time: "23:30",
        is_active: true
    }));

    supabase.store.doctor_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        doctor_id: DOCTOR_A,
        day_of_week: day,
        opening_time: "00:00",
        closing_time: "23:30",
        is_active: true
    }));

    supabase.store.service_types = [CONSULT_TYPE];
    supabase.store.clinic_services = [
        {
            clinic_id: CLINIC_A,
            service_type_id: CONSULT,
            is_enabled: true,
            offered_at_clinic: true,
            offered_at_home: false,
            requires_doctor: true,
            clinic_price: null,
            home_price: null,
            duration_minutes: 30,
            concurrent_capacity: 1,
            display_order: 0,
            available_from: null,
            available_to: null,
            min_booking_window_hours: 0,
            max_booking_window_days: 7,
            service_type: CONSULT_TYPE,
            ...service
        }
    ];
    supabase.store.appointments = [];

    clearClinicServiceCache();
    clearClinicTimezoneCache();

    return {
        client: new MultiClinicSupabaseClient("", "", supabase as never),
        date
    };
}

/** Tomorrow, so "today" rules do not decide the answer. */
function nextDay(date: string): string {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return next.toISOString().slice(0, 10);
}

Deno.test("a service window narrows the hours a consultation is offered in", async () => {
    const { client, date } = build({ available_from: "10:00", available_to: "13:00" });
    const tomorrow = nextDay(date);

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, tomorrow, "CLINIC", CONSULT);

    assertEquals(slots[0], "10:00");
    assertEquals(slots[slots.length - 1], "12:30");
});

Deno.test("without a service the doctor's whole day is still offered", async () => {
    const { client, date } = build({ available_from: "10:00", available_to: "13:00" });
    const tomorrow = nextDay(date);

    // No service id: the window cannot apply, and the day is unchanged.
    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, tomorrow, "CLINIC");

    assertEquals(slots[0], "00:00");
});

Deno.test("notice on a consultation rules out the rest of today", async () => {
    const { client, date } = build({ min_booking_window_hours: 24 });

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, date, "CLINIC", CONSULT);

    assertEquals(slots.length, 0);
});

Deno.test("a day beyond the notice period is untouched by it", async () => {
    const { client, date } = build({ min_booking_window_hours: 8 });
    const wellAhead = nextDay(nextDay(nextDay(date)));

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, wellAhead, "CLINIC", CONSULT);

    assertEquals(slots[0], "00:00");
});

Deno.test("the service window can never widen the doctor's hours", async () => {
    const { client, date } = build({ available_from: "00:00", available_to: "23:59" });
    const tomorrow = nextDay(date);

    const slots = await client.getAvailableSlots(CLINIC_A, DOCTOR_A, tomorrow, "CLINIC", CONSULT);

    // The doctor stops at 23:30 whatever the service says.
    assertEquals(slots[slots.length - 1], "23:00");
});
