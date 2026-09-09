import { describe, expect, it } from "vitest";
import {
  aggregateBookingVolumeByDay,
  computeDoctorCapacity,
  computeNoShowRate,
  computeUtilization,
  enumerateDateRange
} from "./analytics";

describe("enumerateDateRange", () => {
  it("returns every date inclusive, in order", () => {
    expect(enumerateDateRange("2026-01-01", "2026-01-03")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03"
    ]);
  });

  it("returns a single date when from === to", () => {
    expect(enumerateDateRange("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"]);
  });
});

describe("aggregateBookingVolumeByDay", () => {
  it("counts appointments per day and fills gaps with zero", () => {
    const result = aggregateBookingVolumeByDay(
      ["2026-01-01", "2026-01-01", "2026-01-03"],
      { fromDate: "2026-01-01", toDate: "2026-01-03" }
    );

    expect(result).toEqual([
      { date: "2026-01-01", count: 2 },
      { date: "2026-01-02", count: 0 },
      { date: "2026-01-03", count: 1 }
    ]);
  });

  it("returns all zero-count days when there are no appointments", () => {
    const result = aggregateBookingVolumeByDay([], {
      fromDate: "2026-01-01",
      toDate: "2026-01-02"
    });

    expect(result).toEqual([
      { date: "2026-01-01", count: 0 },
      { date: "2026-01-02", count: 0 }
    ]);
  });
});

describe("computeNoShowRate", () => {
  it("divides no-shows by completed + no-show", () => {
    expect(computeNoShowRate({ completed: 3, noShow: 1 })).toBe(0.25);
  });

  it("returns null instead of NaN when there's no Completed/No-Show activity", () => {
    expect(computeNoShowRate({ completed: 0, noShow: 0 })).toBeNull();
  });

  it("is 0 when every relevant appointment was completed", () => {
    expect(computeNoShowRate({ completed: 5, noShow: 0 })).toBe(0);
  });

  it("is 1 when every relevant appointment was a no-show", () => {
    expect(computeNoShowRate({ completed: 0, noShow: 4 })).toBe(1);
  });
});

describe("computeUtilization", () => {
  it("divides booked by capacity", () => {
    expect(computeUtilization(5, 10)).toBe(0.5);
  });

  it("returns null instead of NaN/Infinity when capacity is 0", () => {
    expect(computeUtilization(0, 0)).toBeNull();
    expect(computeUtilization(3, 0)).toBeNull();
  });
});

describe("computeDoctorCapacity", () => {
  it("sums slots per matching weekday window across the range", () => {
    // 2026-01-05 is a Monday, 2026-01-06 a Tuesday, 2026-01-12 the next Monday.
    const capacity = computeDoctorCapacity({
      fromDate: "2026-01-05",
      toDate: "2026-01-12",
      slotDurationMinutes: 30,
      availability: [
        { day_of_week: "Monday", start_time: "09:00:00", end_time: "10:00:00" } // 2 slots/Monday
      ],
      leaveDates: new Set()
    });

    // Two Mondays in range (5th and 12th) x 2 slots each.
    expect(capacity).toBe(4);
  });

  it("zeroes out days the doctor is on leave", () => {
    const capacity = computeDoctorCapacity({
      fromDate: "2026-01-05",
      toDate: "2026-01-12",
      slotDurationMinutes: 30,
      availability: [
        { day_of_week: "Monday", start_time: "09:00:00", end_time: "10:00:00" }
      ],
      leaveDates: new Set(["2026-01-05"])
    });

    // Only the second Monday (12th) counts now.
    expect(capacity).toBe(2);
  });

  it("ignores windows that don't divide evenly, flooring partial slots", () => {
    const capacity = computeDoctorCapacity({
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
      slotDurationMinutes: 20,
      availability: [
        { day_of_week: "Monday", start_time: "09:00:00", end_time: "09:50:00" } // 50 min / 20 = 2.5 -> 2
      ],
      leaveDates: new Set()
    });

    expect(capacity).toBe(2);
  });

  it("returns 0 when there's no matching availability window", () => {
    const capacity = computeDoctorCapacity({
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
      slotDurationMinutes: 30,
      availability: [{ day_of_week: "Sunday", start_time: "09:00:00", end_time: "10:00:00" }],
      leaveDates: new Set()
    });

    expect(capacity).toBe(0);
  });

  it("returns 0 for a non-positive slot duration instead of throwing", () => {
    const capacity = computeDoctorCapacity({
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
      slotDurationMinutes: 0,
      availability: [{ day_of_week: "Monday", start_time: "09:00:00", end_time: "10:00:00" }],
      leaveDates: new Set()
    });

    expect(capacity).toBe(0);
  });
});
