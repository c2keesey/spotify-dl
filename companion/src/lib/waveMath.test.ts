import { timeAtX, xAtTime, peakAtColumn, clampView } from "@/lib/waveMath";

describe("timeAtX / xAtTime", () => {
  const view = { start: 0, end: 100 };

  test("maps ends of the canvas", () => {
    expect(timeAtX(0, 500, view)).toBe(0);
    expect(timeAtX(500, 500, view)).toBe(100);
    expect(timeAtX(250, 500, view)).toBe(50);
  });

  test("clamps outside the view", () => {
    expect(timeAtX(-10, 500, view)).toBe(0);
    expect(timeAtX(600, 500, view)).toBe(100);
  });

  test("xAtTime is the inverse of timeAtX (round trip)", () => {
    for (const t of [0, 12.5, 33, 77.7, 100]) {
      expect(xAtTime(timeAtX(xAtTime(t, 500, view), 500, view), 500, view)).toBeCloseTo(xAtTime(t, 500, view), 6);
      expect(timeAtX(xAtTime(t, 500, view), 500, view)).toBeCloseTo(t, 6);
    }
  });

  test("xAtTime is not clamped", () => {
    expect(xAtTime(-10, 500, view)).toBeLessThan(0);
    expect(xAtTime(200, 500, view)).toBeGreaterThan(500);
  });

  test("zoomed view maps correctly", () => {
    const zoom = { start: 40, end: 60 };
    expect(timeAtX(0, 200, zoom)).toBe(40);
    expect(timeAtX(200, 200, zoom)).toBe(60);
    expect(timeAtX(100, 200, zoom)).toBe(50);
    expect(xAtTime(50, 200, zoom)).toBe(100);
  });
});

describe("peakAtColumn", () => {
  test("returns the max byte over the column's span", () => {
    // rate 1 sample/sec, view spans 0..10 over width 10 → 1 col per second
    const peaks = new Uint8Array([0, 10, 250, 3, 4, 5, 6, 7, 8, 9]);
    const view = { start: 0, end: 10 };
    // column 2 covers t in [2,3) → index 2 → 250
    expect(peakAtColumn(peaks, 1, 2, 10, view)).toBe(250);
  });

  test("picks the max across a multi-index span", () => {
    const peaks = new Uint8Array([1, 2, 3, 200, 5, 6]);
    // rate 2, view 0..3, width 1 → single column covers [0,3) → indices 0..5 → max 200
    const view = { start: 0, end: 3 };
    expect(peakAtColumn(peaks, 2, 0, 1, view)).toBe(200);
  });

  test("guards an empty span by sampling the floor index", () => {
    const peaks = new Uint8Array([11, 22, 33, 44]);
    // very zoomed: view spans 0..1 over width 1000, rate 1 → most columns cover < 1 index
    const view = { start: 0, end: 1 };
    expect(peakAtColumn(peaks, 1, 0, 1000, view)).toBe(11);
  });

  test("clamps indices into the array bounds", () => {
    const peaks = new Uint8Array([5, 6, 7]);
    const view = { start: 0, end: 100 };
    // last column maps to a time beyond the array; should clamp, not crash
    expect(() => peakAtColumn(peaks, 1, 99, 100, view)).not.toThrow();
  });

  test("returns 0 for empty peaks", () => {
    expect(peakAtColumn(new Uint8Array([]), 1, 0, 10, { start: 0, end: 10 })).toBe(0);
  });
});

describe("clampView", () => {
  test("pins into [0, duration] preserving span", () => {
    expect(clampView({ start: -5, end: 10 }, 100)).toEqual({ start: 0, end: 15 });
    expect(clampView({ start: 95, end: 110 }, 100)).toEqual({ start: 85, end: 100 });
  });

  test("caps span at duration", () => {
    expect(clampView({ start: 50, end: 200 }, 100)).toEqual({ start: 0, end: 100 });
  });

  test("enforces minSpan by growing around the center", () => {
    const v = clampView({ start: 10, end: 10.5 }, 100, 2);
    expect(v.end - v.start).toBeCloseTo(2, 6);
    expect((v.start + v.end) / 2).toBeCloseTo(10.25, 6);
  });

  test("default minSpan is 2", () => {
    const v = clampView({ start: 10, end: 10 }, 100);
    expect(v.end - v.start).toBeCloseTo(2, 6);
  });

  test("a view already inside bounds is unchanged", () => {
    expect(clampView({ start: 20, end: 40 }, 100)).toEqual({ start: 20, end: 40 });
  });
});
