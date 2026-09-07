import { describe, expect, it } from "vitest";
import {
  combineDateAndTime,
  formatDateKey,
  formatTimeLabel,
  isValidISODate,
  isoDateToWeekday,
  parseTimeOfDay
} from "./dates";

describe("isValidISODate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidISODate("2026-09-10")).toBe(true);
    expect(isValidISODate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects malformed or impossible dates", () => {
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2025-02-29")).toBe(false); // not a leap year
    expect(isValidISODate("10-09-2026")).toBe(false);
    expect(isValidISODate("not a date")).toBe(false);
  });
});

describe("isoDateToWeekday", () => {
  it("matches known weekdays", () => {
    // 2026-09-07 is a Monday.
    expect(isoDateToWeekday("2026-09-07")).toBe("Monday");
    expect(isoDateToWeekday("2026-09-08")).toBe("Tuesday");
    expect(isoDateToWeekday("2026-09-13")).toBe("Sunday");
  });

  it("throws on an invalid date", () => {
    expect(() => isoDateToWeekday("2026-02-30")).toThrow();
  });
});

describe("parseTimeOfDay", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(parseTimeOfDay("09:30")).toEqual({ hours: 9, minutes: 30 });
    expect(parseTimeOfDay("09:30:00")).toEqual({ hours: 9, minutes: 30 });
    expect(parseTimeOfDay("23:59")).toEqual({ hours: 23, minutes: 59 });
  });

  it("returns null for invalid input instead of throwing", () => {
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("09:60")).toBeNull();
    expect(parseTimeOfDay("not a time")).toBeNull();
  });
});

describe("combineDateAndTime + formatting round-trip", () => {
  it("produces a Date that formats back to the same date/time in the same timezone", () => {
    const combined = combineDateAndTime("2026-09-10", "14:30", "Asia/Kolkata");

    expect(formatDateKey(combined, "Asia/Kolkata")).toBe("2026-09-10");
    expect(formatTimeLabel(combined, "Asia/Kolkata")).toBe("2:30 PM");
  });

  it("is timezone-aware: the same wall-clock time in a different zone is a different instant", () => {
    const istNoon = combineDateAndTime("2026-09-10", "12:00", "Asia/Kolkata");
    const utcNoon = combineDateAndTime("2026-09-10", "12:00", "UTC");

    expect(istNoon.getTime()).not.toBe(utcNoon.getTime());
    // IST is UTC+5:30, so noon IST is 5:30 AM UTC on the same date.
    expect(istNoon.getTime()).toBeLessThan(utcNoon.getTime());
  });
});
