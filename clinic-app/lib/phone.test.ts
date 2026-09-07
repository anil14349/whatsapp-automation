import { describe, expect, it } from "vitest";
import { normalizeWhatsAppPhone, phonesMatch } from "./phone";

describe("normalizeWhatsAppPhone", () => {
  it("strips non-digit characters", () => {
    expect(normalizeWhatsAppPhone("+91 98765-43210")).toBe("9876543210");
  });

  it("keeps only the last 10 digits when longer", () => {
    expect(normalizeWhatsAppPhone("919876543210")).toBe("9876543210");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(normalizeWhatsAppPhone(null)).toBe("");
    expect(normalizeWhatsAppPhone(undefined)).toBe("");
    expect(normalizeWhatsAppPhone("")).toBe("");
  });
});

describe("phonesMatch", () => {
  it("matches the same number with different country-code formatting", () => {
    expect(phonesMatch("+919876543210", "09876543210")).toBe(true);
    expect(phonesMatch("919876543210", "9876543210")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(phonesMatch("9876543210", "9876543211")).toBe(false);
  });

  it("never matches on two blank inputs", () => {
    expect(phonesMatch("", "")).toBe(false);
    expect(phonesMatch(null, null)).toBe(false);
  });
});
