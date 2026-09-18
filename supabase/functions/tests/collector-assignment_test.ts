/**
 * Choosing which collector a home visit goes to.
 *
 * The lightest day rather than round-robin, because a collector who called in
 * sick and has no visits should get the next one, not wait their turn.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, CLINIC_B, today } from "./helpers/fixtures.ts";
import { pickCollector } from "../shared/collector-assignment.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

function build(
    collectors: Record<string, unknown>[],
    appointments: Record<string, unknown>[] = []
) {
    const supabase = fakeSupabase(seed());
    supabase.store.sample_collectors = collectors;
    supabase.store.appointments = appointments;
    return supabase;
}

function collector(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        clinic_id: CLINIC_A,
        name: id,
        phone: `9190000000${id.slice(-1)}`,
        is_active: true,
        max_collections_per_day: 8,
        ...overrides
    };
}

function booked(collectorId: string | null, overrides: Record<string, unknown> = {}) {
    return {
        id: `APT_${Math.random().toString(36).slice(2, 8)}`,
        clinic_id: CLINIC_A,
        appointment_date: today(),
        status: "CONFIRMED",
        collector_id: collectorId,
        ...overrides
    };
}

Deno.test("with nobody on the books, nobody is assigned", async () => {
    const chosen = await pickCollector(build([]) as any, CLINIC_A, today());

    assertEquals(chosen, null);
});

Deno.test("one collector takes it", async () => {
    const chosen = await pickCollector(build([collector("col-1")]) as any, CLINIC_A, today());

    assertEquals(chosen?.id, "col-1");
});

Deno.test("the lighter day takes the next visit", async () => {
    const supabase = build(
        [collector("col-1"), collector("col-2")],
        [booked("col-1"), booked("col-1")]
    );

    const chosen = await pickCollector(supabase as any, CLINIC_A, today());

    assertEquals(chosen?.id, "col-2");
});

Deno.test("a collector at their daily limit is passed over", async () => {
    const supabase = build(
        [collector("col-1", { max_collections_per_day: 1 }), collector("col-2")],
        [booked("col-1")]
    );

    const chosen = await pickCollector(supabase as any, CLINIC_A, today());

    assertEquals(chosen?.id, "col-2");
});

Deno.test("everyone full leaves it unassigned rather than refusing the patient", async () => {
    const supabase = build(
        [collector("col-1", { max_collections_per_day: 1 })],
        [booked("col-1")]
    );

    assertEquals(await pickCollector(supabase as any, CLINIC_A, today()), null);
});

Deno.test("yesterday's round does not count against today", async () => {
    const supabase = build(
        [collector("col-1", { max_collections_per_day: 1 })],
        [booked("col-1", { appointment_date: "2020-01-01" })]
    );

    assertEquals((await pickCollector(supabase as any, CLINIC_A, today()))?.id, "col-1");
});

Deno.test("a cancelled visit frees the slot back up", async () => {
    const supabase = build(
        [collector("col-1", { max_collections_per_day: 1 })],
        [booked("col-1", { status: "CANCELLED" })]
    );

    assertEquals((await pickCollector(supabase as any, CLINIC_A, today()))?.id, "col-1");
});

Deno.test("another clinic's collectors are not borrowed", async () => {
    const supabase = build([collector("col-b", { clinic_id: CLINIC_B })]);

    assertEquals(await pickCollector(supabase as any, CLINIC_A, today()), null);
});
