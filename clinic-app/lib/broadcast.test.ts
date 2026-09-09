import { describe, expect, it } from "vitest";
import { dedupePatientPhones } from "./broadcast";

describe("dedupePatientPhones", () => {
  it("returns each unique patient_phone once, in first-seen order", () => {
    const appointments = [
      { patient_phone: "+15551234567" },
      { patient_phone: "+15557654321" },
      { patient_phone: "+15551234567" }
    ];

    expect(dedupePatientPhones(appointments)).toEqual(["+15551234567", "+15557654321"]);
  });

  it("returns an empty array for no appointments", () => {
    expect(dedupePatientPhones([])).toEqual([]);
  });

  it("returns a single entry when only one appointment exists", () => {
    expect(dedupePatientPhones([{ patient_phone: "+15551234567" }])).toEqual(["+15551234567"]);
  });
});
