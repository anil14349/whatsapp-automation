import { describe, expect, it } from "vitest";
import { hashPassword, validateNewPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt) even for the same password", async () => {
    const hashA = await hashPassword("same password");
    const hashB = await hashPassword("same password");
    expect(hashA).not.toBe(hashB);

    // Both still verify correctly despite being different strings.
    expect(await verifyPassword("same password", hashA)).toBe(true);
    expect(await verifyPassword("same password", hashB)).toBe(true);
  });

  it("rejects a malformed/corrupted stored hash instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt:onlyonepart")).toBe(false);
  });

  it("round-trips a freshly reset password end to end (hash then verify)", async () => {
    // Exercises exactly what resetDoctorPasswordAction does: hash a new
    // password, and the doctor should be able to authenticate with it
    // immediately (see lib/auth/doctorAuthenticate.ts's verifyPassword call).
    const newHash = await hashPassword("a brand new clinic password");
    expect(await verifyPassword("a brand new clinic password", newHash)).toBe(true);
    // The previous password must no longer work against the new hash.
    expect(await verifyPassword("the old password", newHash)).toBe(false);
  });
});

describe("validateNewPassword", () => {
  it("accepts a matching pair at least 8 characters long", () => {
    expect(validateNewPassword("longenough", "longenough")).toBeNull();
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(validateNewPassword("short1", "short1")).toBe(
      "Password must be at least 8 characters."
    );
  });

  it("rejects a mismatched confirmation", () => {
    expect(validateNewPassword("longenough", "different")).toBe("Passwords do not match.");
  });

  it("checks length before match, so a too-short mismatched pair gets the length error", () => {
    expect(validateNewPassword("abc", "xyz")).toBe("Password must be at least 8 characters.");
  });
});
