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
    // Wired up by lib/whatsapp/patientFlow.ts's home collection flow
    // (getHospitalLocation/getHomeCollectionRadiusKm in lib/settings.ts).
    expect(DORMANT_SETTING_KEYS.has("HOSPITAL_LATITUDE")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("HOSPITAL_LONGITUDE")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("HOME_COLLECTION_RADIUS_KM")).toBe(false);
    // Wired up by lib/reminders.ts / lib/afterHours.ts / lib/autoComplete.ts
    // (called from app/api/cron/*/route.ts and lib/whatsapp/router.ts).
    expect(DORMANT_SETTING_KEYS.has("ENABLE_APPOINTMENT_REMINDERS")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("ENABLE_AFTER_HOURS_REPLY")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("AUTO_COMPLETE_PAST_APPOINTMENTS")).toBe(false);
  });

  it("includes settings for features not yet ported (spot check)", () => {
    expect(DORMANT_SETTING_KEYS.has("ENABLE_INBOUND_LOG")).toBe(true);
    expect(DORMANT_SETTING_KEYS.has("LOG_RETENTION")).toBe(true);
  });
});
