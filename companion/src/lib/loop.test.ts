import { shouldWrap } from "@/lib/loop";
import type { Cue } from "@/lib/types";

const loop: Cue = { num: 2, name: "", start: 10, end: 14 };
const point: Cue = { num: 3, name: "", start: 30, end: null };

describe("shouldWrap", () => {
  test("wraps at and past the loop end", () => {
    expect(shouldWrap(14, loop)).toBe(true);
    expect(shouldWrap(14.3, loop)).toBe(true);
  });

  test("does not wrap before the end", () => {
    expect(shouldWrap(13.99, loop)).toBe(false);
    expect(shouldWrap(0, loop)).toBe(false);
  });

  test("point cues and missing cues never wrap", () => {
    expect(shouldWrap(99, point)).toBe(false);
    expect(shouldWrap(99, null)).toBe(false);
    expect(shouldWrap(99, undefined)).toBe(false);
  });
});
