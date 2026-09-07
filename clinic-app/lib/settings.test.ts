import { describe, expect, it } from "vitest";
import { DORMANT_SETTING_KEYS } from "./settings";

describe("DORMANT_SETTING_KEYS", () => {
  it("does not include the two settings actually wired into the webhook route", () => {
    // Regression guard: these two are read by app/api/whatsapp/webhook/route.ts
    // (getSetting/getBooleanSetting). If either ever ends up flagged
    // dormant by mistake, the admin UI would show a misleading "Not yet
    // active" badge on a setting that really does work.
    expect(DORMANT_SETTING_KEYS.has("CLINIC_NAME")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("ENABLE_INTERACTIVE_MENUS")).toBe(false);
  });

  it("includes settings for features not yet ported (spot check)", () => {
    expect(DORMANT_SETTING_KEYS.has("ENABLE_APPOINTMENT_REMINDERS")).toBe(true);
    expect(DORMANT_SETTING_KEYS.has("ENABLE_AFTER_HOURS_REPLY")).toBe(true);
    expect(DORMANT_SETTING_KEYS.has("HOME_COLLECTION_RADIUS_KM")).toBe(true);
  });
});
