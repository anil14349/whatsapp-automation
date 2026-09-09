import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkLoginRateLimit } from "./rateLimit";

describe("checkLoginRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows up to 5 attempts", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit("test@example.com").allowed).toBe(true);
    }
  });

  it("blocks the 6th attempt within the window", () => {
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit("test@blocked.com");
    }
    const result = checkLoginRateLimit("test@blocked.com");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows again after the window expires", () => {
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit("test@expire.com");
    }
    expect(checkLoginRateLimit("test@expire.com").allowed).toBe(false);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(checkLoginRateLimit("test@expire.com").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit("admin:a@a.com");
    }
    expect(checkLoginRateLimit("admin:a@a.com").allowed).toBe(false);
    expect(checkLoginRateLimit("doctor:a@a.com").allowed).toBe(true);
  });
});
