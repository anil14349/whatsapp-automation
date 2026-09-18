/**
 * The notice a clinic needs before it can take a booking.
 *
 * A home collection means sending someone out with a kit, so "in twenty
 * minutes" is not a real appointment. `clinic_services.min_booking_window_hours`
 * held that number from the start and was read by nothing - the only code that
 * mentioned notice was `getHomeCollectionMinLeadHours()`, which read an
 * environment variable that no longer had any callers either. So no minimum
 * was enforced anywhere, and setting the environment variable did nothing.
 *
 * It is per service and per clinic, which is where a policy like this belongs:
 * a blood draw at home needs more warning than walking into the clinic.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A } from "./helpers/fixtures.ts";
import { getClinicServiceSlots } from "../shared/clinic-slots.ts";
import type { ClinicService } from "../shared/clinic-services.ts";

const IST = "Asia/Kolkata";

function build() {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics[0].timezone = IST;
    supabase.store.clinic_operating_hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        clinic_id: CLINIC_A,
        day_of_week: day,
        opening_time: "00:00",
        closing_time: "23:59",
        is_active: true
    }));
    supabase.store.appointments = [];

    return supabase;
}

function service(minNoticeHours: number): ClinicService {
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
        minNoticeHours
    };
}

/** Where the clinic's clock is now, so the tests do not depend on the hour. */
function nowInClinic(): { today: string; minutes: number } {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: IST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(new Date());

    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

    return {
        today: `${part("year")}-${part("month")}-${part("day")}`,
        minutes: Number(part("hour")) * 60 + Number(part("minute"))
    };
}

function toMinutes(label: string): number {
    const [h, m] = label.split(":").map(Number);
    return h * 60 + m;
}

Deno.test("with no notice required the next slot today is still offered", async () => {
    const supabase = build();
    const { today, minutes } = nowInClinic();

    const slots = await getClinicServiceSlots(supabase, CLINIC_A, service(0), today);

    // Something later today, unless it is the very end of the day.
    if (minutes < 22 * 60) {
        assertEquals(slots.length > 0, true);
        assertEquals(toMinutes(slots[0]) > minutes, true);
    }
});

Deno.test("eight hours' notice rules out everything sooner than that today", async () => {
    const supabase = build();
    const { today, minutes } = nowInClinic();

    const slots = await getClinicServiceSlots(supabase, CLINIC_A, service(8), today);

    for (const slot of slots) {
        assertEquals(toMinutes(slot) > minutes + 8 * 60, true);
    }
});

Deno.test("the notice carries into tomorrow morning when it has to", async () => {
    const supabase = build();
    const { today, minutes } = nowInClinic();

    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const slots = await getClinicServiceSlots(
        supabase,
        CLINIC_A,
        service(8),
        tomorrow.toISOString().slice(0, 10)
    );

    // Eight hours from now, expressed on tomorrow's clock.
    const earliestTomorrow = minutes + 8 * 60 - 24 * 60;

    for (const slot of slots) {
        assertEquals(toMinutes(slot) > earliestTomorrow, true);
    }
});

Deno.test("a day far enough ahead is untouched by the notice", async () => {
    const supabase = build();

    const withNotice = await getClinicServiceSlots(supabase, CLINIC_A, service(8), "2099-09-21");
    const without = await getClinicServiceSlots(supabase, CLINIC_A, service(0), "2099-09-21");

    assertEquals(withNotice.length, without.length);
    assertEquals(withNotice[0], without[0]);
});

Deno.test("a slot inside the notice period cannot be booked directly either", async () => {
    const supabase = build();
    const { today, minutes } = nowInClinic();

    const { isClinicServiceSlotAvailable } = await import("../shared/clinic-slots.ts");

    // An hour from now, rounded to the hour, is well inside eight hours' notice.
    const soon = Math.min(23, Math.floor(minutes / 60) + 1);
    const label = `${String(soon).padStart(2, "0")}:00`;

    assertEquals(
        await isClinicServiceSlotAvailable(supabase, CLINIC_A, service(8), today, label),
        false
    );
});
