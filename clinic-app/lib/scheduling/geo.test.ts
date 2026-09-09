import { describe, expect, it } from "vitest";
import { haversineDistanceKm } from "./geo";

describe("haversineDistanceKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceKm(17.385, 78.4867, 17.385, 78.4867)).toBeCloseTo(0, 6);
  });

  it("matches a known distance (roughly Hyderabad to Secunderabad, ~8km)", () => {
    const distance = haversineDistanceKm(17.385, 78.4867, 17.4399, 78.4983);
    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThan(10);
  });

  it("is symmetric", () => {
    const a = haversineDistanceKm(17.385, 78.4867, 12.9716, 77.5946);
    const b = haversineDistanceKm(12.9716, 77.5946, 17.385, 78.4867);
    expect(a).toBeCloseTo(b, 9);
  });
});
