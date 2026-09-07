import { describe, expect, it } from "vitest";
import { isValidPatientName, normalizePatientLanguage } from "./patients";

describe("isValidPatientName", () => {
  it("accepts a normal name", () => {
    expect(isValidPatientName("Anil Kumar")).toBe(true);
  });

  it("rejects blank/too-short names", () => {
    expect(isValidPatientName("")).toBe(false);
    expect(isValidPatientName("A")).toBe(false);
    expect(isValidPatientName(null)).toBe(false);
    expect(isValidPatientName(undefined)).toBe(false);
  });

  it("rejects an all-digit string (someone typing their phone number by mistake)", () => {
    expect(isValidPatientName("9876543210")).toBe(false);
  });
});

describe("normalizePatientLanguage", () => {
  it("uppercases and passes through a supported language", () => {
    expect(normalizePatientLanguage("te")).toBe("TE");
    expect(normalizePatientLanguage("ML")).toBe("ML");
  });

  it("falls back to EN for anything unsupported or blank", () => {
    expect(normalizePatientLanguage("fr")).toBe("EN");
    expect(normalizePatientLanguage("")).toBe("EN");
    expect(normalizePatientLanguage(null)).toBe("EN");
  });
});
