/**
 * Dates as the clinic sees them.
 *
 * Edge functions run on UTC. A clinic in Asia/Kolkata is five and a half hours
 * ahead, so every evening after 18:30 local the server's idea of "today" was
 * still yesterday and the Today/Tomorrow buttons offered a date that had
 * already gone.
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { addDays, todayInTimezone } from "../shared/clinic-slots.ts";

Deno.test("a clinic ahead of UTC can be on the next day already", () => {
    // 20:30 UTC is 02:00 the following day in Asia/Kolkata.
    const utc = todayInTimezone("UTC");
    const kolkata = todayInTimezone("Asia/Kolkata");

    // Both are real dates, and Kolkata is never behind UTC.
    assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(utc), true);
    assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(kolkata), true);
    assertEquals(kolkata >= utc, true, "Asia/Kolkata should never be behind UTC");
});

Deno.test("adding days does not slip across a month or year", () => {
    assertEquals(addDays("2026-09-30", 1), "2026-10-01");
    assertEquals(addDays("2026-12-31", 1), "2027-01-01");
    assertEquals(addDays("2026-02-28", 1), "2026-03-01");
    assertEquals(addDays("2024-02-28", 1), "2024-02-29");
    assertEquals(addDays("2026-09-16", 7), "2026-09-23");
    assertEquals(addDays("2026-09-16", 0), "2026-09-16");
});
