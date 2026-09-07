import { describe, expect, it } from "vitest";
import { computeAvailableSlots } from "./availability";
import { combineDateAndTime } from "./dates";

const TZ = "Asia/Kolkata";
const at = (date: string, time: string) => combineDateAndTime(date, time, TZ);

describe("computeAvailableSlots", () => {
  it("splits a window into slots of the given duration", () => {
    const slots = computeAvailableSlots({
      windows: [{ start: at("2026-09-10", "09:00"), end: at("2026-09-10", "10:00") }],
      busyIntervals: [],
      slotDurationMinutes: 30,
      now: at("2026-09-01", "00:00") // well before the window, nothing is "past"
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual(at("2026-09-10", "09:00"));
    expect(slots[1]).toEqual(at("2026-09-10", "09:30"));
  });

  it("drops a trailing partial slot that wouldn't fit before the window closes", () => {
    const slots = computeAvailableSlots({
      windows: [{ start: at("2026-09-10", "09:00"), end: at("2026-09-10", "10:15") }],
      busyIntervals: [],
      slotDurationMinutes: 30,
      now: at("2026-09-01", "00:00")
    });

    // 09:00-09:30, 09:30-10:00 fit; a third slot would run 10:00-10:30,
    // past the 10:15 close, so it must not appear.
    expect(slots).toHaveLength(2);
  });

  it("excludes a slot that overlaps a busy interval", () => {
    const slots = computeAvailableSlots({
      windows: [{ start: at("2026-09-10", "09:00"), end: at("2026-09-10", "10:00") }],
      busyIntervals: [
        { start: at("2026-09-10", "09:30"), end: at("2026-09-10", "10:00") }
      ],
      slotDurationMinutes: 30,
      now: at("2026-09-01", "00:00")
    });

    expect(slots).toEqual([at("2026-09-10", "09:00")]);
  });

  it("excludes a slot that only partially overlaps a busy interval (not just exact matches)", () => {
    const slots = computeAvailableSlots({
      windows: [{ start: at("2026-09-10", "09:00"), end: at("2026-09-10", "10:00") }],
      busyIntervals: [
        // A 20-minute meeting starting mid-slot still conflicts with the whole slot.
        { start: at("2026-09-10", "09:10"), end: at("2026-09-10", "09:20") }
      ],
      slotDurationMinutes: 30,
      now: at("2026-09-01", "00:00")
    });

    expect(slots).toEqual([at("2026-09-10", "09:30")]);
  });

  it("excludes slots that have already passed relative to `now`", () => {
    const slots = computeAvailableSlots({
      windows: [{ start: at("2026-09-10", "09:00"), end: at("2026-09-10", "11:00") }],
      busyIntervals: [],
      slotDurationMinutes: 30,
      now: at("2026-09-10", "09:45") // mid-way through the window
    });

    expect(slots).toEqual([
      at("2026-09-10", "10:00"),
      at("2026-09-10", "10:30")
    ]);
  });

  it("merges multiple windows on the same day (e.g. morning + evening sessions)", () => {
    const slots = computeAvailableSlots({
      windows: [
        { start: at("2026-09-10", "09:00"), end: at("2026-09-10", "09:30") },
        { start: at("2026-09-10", "17:00"), end: at("2026-09-10", "17:30") }
      ],
      busyIntervals: [],
      slotDurationMinutes: 30,
      now: at("2026-09-01", "00:00")
    });

    expect(slots).toEqual([
      at("2026-09-10", "09:00"),
      at("2026-09-10", "17:00")
    ]);
  });

  it("de-duplicates a slot that appears in two overlapping windows", () => {
    const slots = computeAvailableSlots({
      windows: [
        { start: at("2026-09-10", "09:00"), end: at("2026-09-10", "10:00") },
        { start: at("2026-09-10", "09:00"), end: at("2026-09-10", "09:30") }
      ],
      busyIntervals: [],
      slotDurationMinutes: 30,
      now: at("2026-09-01", "00:00")
    });

    expect(slots).toEqual([
      at("2026-09-10", "09:00"),
      at("2026-09-10", "09:30")
    ]);
  });

  it("returns an empty array when there are no windows", () => {
    expect(
      computeAvailableSlots({
        windows: [],
        busyIntervals: [],
        slotDurationMinutes: 30
      })
    ).toEqual([]);
  });

  it("rejects a non-positive slot duration", () => {
    expect(() =>
      computeAvailableSlots({
        windows: [{ start: at("2026-09-10", "09:00"), end: at("2026-09-10", "10:00") }],
        busyIntervals: [],
        slotDurationMinutes: 0
      })
    ).toThrow();
  });

  it("a future date is never treated as already-past, regardless of time-of-day quirks", () => {
    // Regression guard for the timezone-ambiguity bug this function's
    // design deliberately avoids (see the comment in availability.ts) —
    // `now` here is late at night UTC, which is already the next day in
    // IST, the kind of boundary condition a naive "is this today" check
    // could get wrong.
    const slots = computeAvailableSlots({
      windows: [{ start: at("2026-09-11", "09:00"), end: at("2026-09-11", "10:00") }],
      busyIntervals: [],
      slotDurationMinutes: 30,
      now: at("2026-09-10", "23:30")
    });

    expect(slots).toHaveLength(2);
  });
});
