import { cueReducer } from "@/lib/cueStore";
import type { Cue } from "@/lib/types";

const point = (num: number, over: Partial<Cue> = {}): Cue => ({ num, name: "", start: 10, end: null, ...over });
const loop = (num: number, over: Partial<Cue> = {}): Cue => ({ num, name: "", start: 10, end: 20, ...over });

describe("cueReducer — place", () => {
  test("places a point cue into an empty slot", () => {
    const out = cueReducer([], { type: "place", num: 3, start: 42 });
    expect(out).toEqual([{ num: 3, name: "", start: 42, end: null }]);
  });

  test("clamps a negative start to 0 on place", () => {
    const out = cueReducer([], { type: "place", num: 0, start: -5 });
    expect(out[0].start).toBe(0);
  });

  test("replaces an occupied slot", () => {
    const out = cueReducer([loop(3)], { type: "place", num: 3, start: 99 });
    expect(out).toEqual([{ num: 3, name: "", start: 99, end: null }]);
  });

  test("keeps the array sorted by num", () => {
    let s: Cue[] = [];
    s = cueReducer(s, { type: "place", num: 5, start: 1 });
    s = cueReducer(s, { type: "place", num: 2, start: 1 });
    s = cueReducer(s, { type: "place", num: 7, start: 1 });
    expect(s.map((c) => c.num)).toEqual([2, 5, 7]);
  });

  test("ignores a num outside 0..7 (unchanged)", () => {
    const start: Cue[] = [point(1)];
    expect(cueReducer(start, { type: "place", num: 8, start: 1 })).toBe(start);
    expect(cueReducer(start, { type: "place", num: -1, start: 1 })).toBe(start);
  });

  test("returns a new array (no mutation)", () => {
    const start: Cue[] = [point(1)];
    const out = cueReducer(start, { type: "place", num: 2, start: 1 });
    expect(out).not.toBe(start);
    expect(start).toHaveLength(1);
  });
});

describe("cueReducer — move", () => {
  test("moves a point cue's start", () => {
    const out = cueReducer([point(1, { start: 10 })], { type: "move", num: 1, start: 30 });
    expect(out[0]).toEqual({ num: 1, name: "", start: 30, end: null });
  });

  test("clamps move start to 0", () => {
    const out = cueReducer([point(1)], { type: "move", num: 1, start: -8 });
    expect(out[0].start).toBe(0);
  });

  test("preserves loop length when moving", () => {
    const out = cueReducer([loop(1, { start: 10, end: 20 })], { type: "move", num: 1, start: 55 });
    expect(out[0].start).toBe(55);
    expect(out[0].end).toBe(65);
    expect(out[0].end! - out[0].start).toBe(10);
  });

  test("preserves loop length even when clamped to 0", () => {
    const out = cueReducer([loop(1, { start: 10, end: 20 })], { type: "move", num: 1, start: -100 });
    expect(out[0].start).toBe(0);
    expect(out[0].end).toBe(10);
  });
});

describe("cueReducer — setLoopEnd", () => {
  test("sets a loop end", () => {
    const out = cueReducer([point(1, { start: 10 })], { type: "setLoopEnd", num: 1, end: 25 });
    expect(out[0].end).toBe(25);
  });

  test("ignores end <= start (state unchanged)", () => {
    const start: Cue[] = [point(1, { start: 10 })];
    expect(cueReducer(start, { type: "setLoopEnd", num: 1, end: 10 })).toBe(start);
    expect(cueReducer(start, { type: "setLoopEnd", num: 1, end: 5 })).toBe(start);
  });

  test("null converts a loop back to a point cue", () => {
    const out = cueReducer([loop(1)], { type: "setLoopEnd", num: 1, end: null });
    expect(out[0].end).toBeNull();
  });
});

describe("cueReducer — clear & rename", () => {
  test("clear removes the cue", () => {
    const out = cueReducer([point(1), point(2)], { type: "clear", num: 1 });
    expect(out.map((c) => c.num)).toEqual([2]);
  });

  test("rename sets the name", () => {
    const out = cueReducer([point(1)], { type: "rename", num: 1, name: "Drop" });
    expect(out[0].name).toBe("Drop");
  });
});
