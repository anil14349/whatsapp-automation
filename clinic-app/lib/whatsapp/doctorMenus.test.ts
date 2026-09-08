import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  parseAvailabilitySessionSelection,
  parseLeaveSelection,
  parseWeekdaySelection
} from "./doctorMenus";
import type { DoctorAvailability, DoctorLeave } from "@/lib/doctors";

describe("parseWeekdaySelection", () => {
  it("resolves a list-tap id", () => {
    expect(parseWeekdaySelection("day_Wednesday")).toBe("Wednesday");
  });

  it("resolves a 1-based typed number", () => {
    expect(parseWeekdaySelection("1")).toBe(WEEKDAYS[0]);
    expect(parseWeekdaySelection("7")).toBe(WEEKDAYS[6]);
  });

  it("rejects invalid input", () => {
    expect(parseWeekdaySelection("day_Notaday")).toBeNull();
    expect(parseWeekdaySelection("0")).toBeNull();
    expect(parseWeekdaySelection("8")).toBeNull();
    expect(parseWeekdaySelection("abc")).toBeNull();
  });
});

function makeAvailability(id: string, day: DoctorAvailability["day_of_week"]): DoctorAvailability {
  return {
    id,
    doctor_id: "doc-1",
    day_of_week: day,
    start_time: "09:00",
    end_time: "13:00"
  } as DoctorAvailability;
}

describe("parseAvailabilitySessionSelection", () => {
  const availability = [makeAvailability("a1", "Monday"), makeAvailability("a2", "Tuesday")];

  it("resolves a list-tap id to the matching row", () => {
    expect(parseAvailabilitySessionSelection("session_a2", availability)).toEqual(availability[1]);
  });

  it("resolves a 1-based typed number", () => {
    expect(parseAvailabilitySessionSelection("1", availability)).toEqual(availability[0]);
  });

  it("rejects an unknown id or out-of-range number", () => {
    expect(parseAvailabilitySessionSelection("session_unknown", availability)).toBeNull();
    expect(parseAvailabilitySessionSelection("99", availability)).toBeNull();
  });
});

function makeLeave(id: string, date: string): DoctorLeave {
  return {
    id,
    doctor_id: "doc-1",
    leave_date: date,
    reason: "",
    active: true
  } as DoctorLeave;
}

describe("parseLeaveSelection", () => {
  const leaves = [makeLeave("l1", "2026-01-01"), makeLeave("l2", "2026-01-02")];

  it("resolves a list-tap id to the matching leave", () => {
    expect(parseLeaveSelection("leave_l2", leaves)).toEqual(leaves[1]);
  });

  it("resolves a 1-based typed number", () => {
    expect(parseLeaveSelection("2", leaves)).toEqual(leaves[1]);
  });

  it("rejects an unknown id or out-of-range number", () => {
    expect(parseLeaveSelection("leave_unknown", leaves)).toBeNull();
    expect(parseLeaveSelection("0", leaves)).toBeNull();
  });
});
