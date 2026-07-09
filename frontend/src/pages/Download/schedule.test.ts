import { describe, expect, it } from "vitest";
import { clampHours, HOURS_MAX, HOURS_MIN } from "./schedule";

describe("clampHours", () => {
  it("keeps in-range values", () => {
    expect(clampHours(6)).toBe(6);
    expect(clampHours("12")).toBe(12);
  });

  it("clamps to the bounds", () => {
    expect(clampHours(0)).toBe(HOURS_MIN);
    expect(clampHours(99)).toBe(HOURS_MAX);
    expect(clampHours(-4)).toBe(HOURS_MIN);
  });

  it("coerces empty / NaN to the minimum (no invalid */0 cron)", () => {
    expect(clampHours("")).toBe(HOURS_MIN);
    expect(clampHours(NaN)).toBe(HOURS_MIN);
    expect(clampHours("abc")).toBe(HOURS_MIN);
  });

  it("truncates fractional input", () => {
    expect(clampHours(6.9)).toBe(6);
  });
});
