import { describe, expect, it } from "vitest";
import { isDoctorFreeTextEntryState } from "./router";

describe("isDoctorFreeTextEntryState", () => {
  it("is true for every doctor-flow state that expects free-form text", () => {
    const freeTextStates = [
      "DOCTOR_AVAIL_START",
      "DOCTOR_AVAIL_END",
      "DOCTOR_LEAVE_DATE",
      "DOCTOR_LEAVE_REASON",
      "DOCTOR_LEAVE_RANGE_START",
      "DOCTOR_LEAVE_RANGE_END",
      "DOCTOR_LEAVE_RANGE_REASON",
      "DOCTOR_RESCHEDULE_DATE_CUSTOM",
      "DOCTOR_BROADCAST_DATE_CUSTOM",
      "DOCTOR_BROADCAST_MESSAGE"
    ];

    for (const state of freeTextStates) {
      expect(isDoctorFreeTextEntryState(state)).toBe(true);
    }
  });

  it("is false for menu-driven states, where the greeting shortcut should still apply", () => {
    const menuStates = [
      "DOCTOR_MENU",
      "DOCTOR_APPT_LIST",
      "DOCTOR_APPT_ACTION",
      "DOCTOR_CANCEL_CONFIRM",
      "DOCTOR_RESCHEDULE_DATE",
      "DOCTOR_RESCHEDULE_TIME",
      "DOCTOR_RESCHEDULE_CONFIRM",
      "DOCTOR_AVAIL_MENU",
      "DOCTOR_AVAIL_DAY",
      "DOCTOR_AVAIL_REMOVE",
      "DOCTOR_LEAVE_MENU",
      "DOCTOR_LEAVE_CANCEL_PICK",
      "DOCTOR_BROADCAST_DATE",
      "DOCTOR_BROADCAST_CONFIRM"
    ];

    for (const state of menuStates) {
      expect(isDoctorFreeTextEntryState(state)).toBe(false);
    }
  });

  it("is false for a missing/unknown session state", () => {
    expect(isDoctorFreeTextEntryState(null)).toBe(false);
    expect(isDoctorFreeTextEntryState(undefined)).toBe(false);
    expect(isDoctorFreeTextEntryState("")).toBe(false);
    expect(isDoctorFreeTextEntryState("SOME_UNKNOWN_STATE")).toBe(false);
  });
});
