import { describe, expect, it } from "vitest";
import { applyClinicNamePlaceholder, localizeWhatsAppReply } from "./localize";
import translations from "./localization.json";

describe("localization.json (extracted from src/View_Messages.gs)", () => {
  it("has all 5 non-English languages with a substantial, consistent key count", () => {
    const dict = translations as Record<string, Record<string, string>>;
    expect(Object.keys(dict).sort()).toEqual(["HI", "KA", "ML", "TA", "TE"]);

    for (const lang of Object.keys(dict)) {
      expect(Object.keys(dict[lang]!).length).toBeGreaterThan(100);
    }
  });
});

describe("applyClinicNamePlaceholder", () => {
  it("substitutes every occurrence", () => {
    expect(
      applyClinicNamePlaceholder("Welcome to {{CLINIC_NAME}}! {{CLINIC_NAME}} rocks.", "ABC Clinic")
    ).toBe("Welcome to ABC Clinic! ABC Clinic rocks.");
  });
});

describe("localizeWhatsAppReply", () => {
  it("passes English through unchanged apart from the clinic-name placeholder", () => {
    expect(localizeWhatsAppReply("EN", "Please choose a date:", "ABC Clinic")).toBe(
      "Please choose a date:"
    );
    expect(
      localizeWhatsAppReply("EN", "Welcome to {{CLINIC_NAME}}!", "ABC Clinic")
    ).toBe("Welcome to ABC Clinic!");
  });

  it("translates a known phrase into Telugu", () => {
    expect(localizeWhatsAppReply("TE", "Book Appointment", "ABC Clinic")).toBe(
      "అపాయింట్‌మెంట్ బుక్ చేయండి"
    );
  });

  it("translates the clinic-name-bearing welcome message in every supported language", () => {
    for (const lang of ["TE", "HI", "KA", "TA", "ML"] as const) {
      const result = localizeWhatsAppReply(lang, "Welcome to {{CLINIC_NAME}}!", "ABC Clinic");
      expect(result).toContain("ABC Clinic");
      expect(result).not.toContain("{{CLINIC_NAME}}");
    }
  });

  it("falls back to English (untranslated) for an unsupported language code", () => {
    expect(localizeWhatsAppReply("FR", "Confirm", "ABC Clinic")).toBe("Confirm");
  });

  it("falls back to the original English substring for a phrase with no translation entry", () => {
    const result = localizeWhatsAppReply(
      "TE",
      "Some brand-new phrase that has never been translated.",
      "ABC Clinic"
    );
    expect(result).toBe("Some brand-new phrase that has never been translated.");
  });

  it("is case-insensitive on the language code", () => {
    expect(localizeWhatsAppReply("te", "Confirm", "ABC Clinic")).toBe(
      localizeWhatsAppReply("TE", "Confirm", "ABC Clinic")
    );
  });
});
