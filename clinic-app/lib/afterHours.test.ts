import { describe, expect, it } from "vitest";
import {
  buildAfterHoursMessage,
  formatClinicTimeForDisplay,
  formatClinicWorkingDaysForDisplay,
  isWithinClinicHours,
  parseClinicWorkingDays
} from "./afterHours";
import type { AfterHoursSettings } from "./afterHours";

describe("parseClinicWorkingDays", () => {
  it("maps short/long day-name aliases to full weekday names", () => {
    expect(parseClinicWorkingDays("Mon,Tue,Wed,Thu,Fri,Sat")).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday"
    ]);
    expect(parseClinicWorkingDays("monday, sunday")).toEqual(["Monday", "Sunday"]);
  });

  it("dedupes repeated days and ignores unrecognized ones", () => {
    expect(parseClinicWorkingDays("Mon,mon,notaday")).toEqual(["Monday"]);
  });

  it("falls back to Mon-Sat when blank or nothing recognized", () => {
    const defaultDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    expect(parseClinicWorkingDays("")).toEqual(defaultDays);
    expect(parseClinicWorkingDays("nonsense")).toEqual(defaultDays);
  });
});

describe("formatClinicWorkingDaysForDisplay", () => {
  it("shows a single day as-is", () => {
    expect(formatClinicWorkingDaysForDisplay(["Monday"])).toBe("Mon");
  });

  it("shows a range as first-last", () => {
    expect(formatClinicWorkingDaysForDisplay(["Monday", "Tuesday", "Saturday"])).toBe("Mon–Sat");
  });
});

describe("formatClinicTimeForDisplay", () => {
  it("converts 24h to 12h with AM/PM", () => {
    expect(formatClinicTimeForDisplay("09:00")).toBe("9:00 AM");
    expect(formatClinicTimeForDisplay("18:00")).toBe("6:00 PM");
    expect(formatClinicTimeForDisplay("00:00")).toBe("12:00 AM");
    expect(formatClinicTimeForDisplay("12:00")).toBe("12:00 PM");
  });
});

describe("isWithinClinicHours", () => {
  const settings: AfterHoursSettings = {
    enabled: true,
    openTime: "09:00",
    closeTime: "18:00",
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    customMessage: ""
  };

  it("is true inside open hours on a working day", () => {
    // 2026-09-08 is a Tuesday; noon IST.
    const now = new Date("2026-09-08T06:30:00.000Z"); // 12:00 IST
    expect(isWithinClinicHours(now, settings, "Asia/Kolkata")).toBe(true);
  });

  it("is false before opening or after closing on a working day", () => {
    const beforeOpen = new Date("2026-09-08T02:00:00.000Z"); // 7:30 AM IST
    const afterClose = new Date("2026-09-08T13:00:00.000Z"); // 6:30 PM IST
    expect(isWithinClinicHours(beforeOpen, settings, "Asia/Kolkata")).toBe(false);
    expect(isWithinClinicHours(afterClose, settings, "Asia/Kolkata")).toBe(false);
  });

  it("is false on a non-working day even during working hours", () => {
    // 2026-09-06 is a Sunday, not in the default working days.
    const sundayNoon = new Date("2026-09-06T06:30:00.000Z");
    expect(isWithinClinicHours(sundayNoon, settings, "Asia/Kolkata")).toBe(false);
  });

  it("fails open (treats as within hours) when open/close times don't parse", () => {
    const badSettings: AfterHoursSettings = { ...settings, openTime: "garbage", closeTime: "also garbage" };
    expect(isWithinClinicHours(new Date(), badSettings, "Asia/Kolkata")).toBe(true);
  });
});

describe("buildAfterHoursMessage", () => {
  it("uses the custom message when set", () => {
    const settings: AfterHoursSettings = {
      enabled: true,
      openTime: "09:00",
      closeTime: "18:00",
      workingDays: ["Monday"],
      customMessage: "We are closed for a holiday."
    };
    expect(buildAfterHoursMessage("EN", "ABC Clinic", settings)).toBe("We are closed for a holiday.");
  });

  it("builds the default message with hours when no custom message is set", () => {
    const settings: AfterHoursSettings = {
      enabled: true,
      openTime: "09:00",
      closeTime: "18:00",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      customMessage: ""
    };
    const message = buildAfterHoursMessage("EN", "ABC Clinic", settings);
    expect(message).toContain("ABC Clinic is currently closed");
    expect(message).toContain("Mon–Sat, 9:00 AM – 6:00 PM");
  });
});
