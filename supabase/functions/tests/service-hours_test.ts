/**
 * Hours the clinic actually keeps, not the week-wide pair.
 *
 * Two faults with one cause - `clinics.open_time`/`close_time` is a single
 * window for the whole week, while `clinic_operating_hours` holds a row per
 * day and is what booking already uses.
 *
 * The after-hours reply asked the week-wide pair, so with real hours set it
 * would have told a patient the clinic was shut at 07:00 on a Monday that
 * opens at 06:30, and quoted the wrong hours back to them.
 *
 * Slots for a doctor-free service took the premises hours whole, so Sample
 * Collection offered 102 slots on a Monday, the last at 23:20. A home blood
 * draw could be booked for twenty past eleven at night.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A } from "./helpers/fixtures.ts";
import { clinicOpenState, getClinicServiceSlots } from "../shared/clinic-slots.ts";
import type { ClinicService } from "../shared/clinic-services.ts";

const IST = "Asia/Kolkata";

/** A Monday. */
const MONDAY = "2099-09-21";

function build() {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics[0].timezone = IST;
    supabase.store.clinics[0].open_time = "09:00";
    supabase.store.clinics[0].close_time = "22:30";
    supabase.store.clinics[0].working_days = "Mon,Tue,Wed,Thu,Fri,Sat,Sun";

    // A row per weekday, all with the same distinctive hours, so the test does
    // not depend on which day it happens to run. The week-wide pair above is
    // deliberately different, so falling back to it is visible.
    supabase.store.clinic_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        day_of_week: day,
        opening_time: "06:30",
        closing_time: "23:30",
        is_active: true
    }));
    supabase.store.appointments = [];

    return supabase;
}

function labService(overrides: Partial<ClinicService> = {}): ClinicService {
    return {
        serviceTypeId: "svc-lab",
        code: "SAMPLE_COLLECTION",
        name: "Sample Collection",
        category: "DIAGNOSTIC",
        requiresDoctor: false,
        offeredAtClinic: true,
        offeredAtHome: true,
        clinicPrice: 300,
        homePrice: 400,
        durationMinutes: 60,
        concurrentCapacity: 2,
        displayOrder: 0,
        availableFrom: null,
        availableTo: null,
        ...overrides
    };
}

Deno.test("the day's own hours decide whether the clinic is open, not the week-wide pair", async () => {
    const supabase = build();

    const state = await clinicOpenState(supabase, CLINIC_A, IST);

    // Whatever the wall clock says, the hours reported are Monday's when it is
    // Monday, and the week-wide 09:00-22:30 never appears.
    if (state.hours) {
        assertEquals(state.hours.openTime, "06:30");
        assertEquals(state.hours.closeTime, "23:30");
    }
});

Deno.test("a day marked inactive is closed all day and offers no hours", async () => {
    const supabase = build();
    for (const row of supabase.store.clinic_operating_hours) {
        row.is_active = false;
    }

    const state = await clinicOpenState(supabase, CLINIC_A, IST);

    assertEquals(state.open, false);
    assertEquals(state.hours, null);
});

Deno.test("without its own window a lab runs as late as the building", async () => {
    const supabase = build();

    const slots = await getClinicServiceSlots(supabase, CLINIC_A, labService(), MONDAY);

    assertEquals(slots[0], "06:30");
    assertEquals(slots[slots.length - 1], "22:30");
});

Deno.test("its own window keeps a blood draw out of the late evening", async () => {
    const supabase = build();

    const slots = await getClinicServiceSlots(
        supabase,
        CLINIC_A,
        labService({ availableFrom: "07:00", availableTo: "19:00" }),
        MONDAY
    );

    assertEquals(slots[0], "07:00");
    assertEquals(slots[slots.length - 1], "18:00");
    assertEquals(
        slots.some((s) => s >= "19:00"),
        false
    );
});

Deno.test("the service window narrows the premises hours and can never widen them", async () => {
    const supabase = build();

    const slots = await getClinicServiceSlots(
        supabase,
        CLINIC_A,
        labService({ availableFrom: "05:00", availableTo: "23:59" }),
        MONDAY
    );

    assertEquals(slots[0], "06:30");
    assertEquals(slots[slots.length - 1], "22:30");
});

Deno.test("a slot outside the service's window cannot be booked directly either", async () => {
    const supabase = build();

    const { isClinicServiceSlotAvailable } = await import("../shared/clinic-slots.ts");

    const late = await isClinicServiceSlotAvailable(
        supabase,
        CLINIC_A,
        labService({ availableFrom: "07:00", availableTo: "19:00" }),
        MONDAY,
        "22:00"
    );

    assertEquals(late, false);
});
