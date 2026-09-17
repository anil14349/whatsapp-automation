/**
 * When the home collection reminder is due.
 *
 * The same pair of faults the appointment reminders had, found by auditing for
 * them rather than by a patient noticing. The scheduled time was written as
 * `${collectionDate}T08:00:00Z` — 08:00 UTC, which is half past one in the
 * afternoon in Asia/Kolkata, so the "we are coming this morning" reminder went
 * out after a morning collection had already happened. And a collection booked
 * for today was given a time that had already passed, left PENDING, and sent at
 * once.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A } from "./helpers/fixtures.ts";
import { createHomeCollectionReminder } from "../shared/home-collection-reminders.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const PHONE = "919000000001";

function build(timezone = "Asia/Kolkata") {
    const supabase = fakeSupabase(seed());

    supabase.store.clinics[0].timezone = timezone;
    supabase.store.home_collection_reminders = [];

    return supabase;
}

function only(supabase: any) {
    return supabase.rows("home_collection_reminders")[0];
}

Deno.test("08:00 means eight in the morning where the clinic is", async () => {
    const supabase = build();

    await createHomeCollectionReminder(supabase as any, CLINIC_A, "REQ_1", "2099-06-10", PHONE);

    // 08:00 IST is 02:30 UTC the same day.
    assertEquals(only(supabase)?.scheduled_time, "2099-06-10T02:30:00.000Z");
});

Deno.test("a clinic on UTC is unaffected", async () => {
    const supabase = build("UTC");

    await createHomeCollectionReminder(supabase as any, CLINIC_A, "REQ_2", "2099-06-10", PHONE);

    assertEquals(only(supabase)?.scheduled_time, "2099-06-10T08:00:00.000Z");
});

Deno.test("a future collection is left to be reminded", async () => {
    const supabase = build();

    await createHomeCollectionReminder(supabase as any, CLINIC_A, "REQ_3", "2099-06-10", PHONE);

    assertEquals(only(supabase)?.status, "PENDING");
});

Deno.test("a collection whose morning has gone is not reminded about now", async () => {
    const supabase = build();

    await createHomeCollectionReminder(supabase as any, CLINIC_A, "REQ_4", "2020-01-01", PHONE);

    assertEquals(only(supabase)?.status, "SKIPPED");
});
