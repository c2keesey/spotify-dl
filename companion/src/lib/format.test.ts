import { formatClock, formatDuration, totalRuntime } from "@/lib/format";

describe("formatClock", () => {
  test("m:ss under an hour, zero-padded seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(599)).toBe("9:59");
  });

  test("h:mm:ss at or over an hour", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });

  test("rounds and clamps negatives to zero", () => {
    expect(formatClock(65.4)).toBe("1:05");
    expect(formatClock(65.6)).toBe("1:06");
    expect(formatClock(-10)).toBe("0:00");
  });
});

describe("formatDuration", () => {
  test("blank for null or non-finite", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(Infinity)).toBe("");
    expect(formatDuration(NaN)).toBe("");
  });

  test("delegates to formatClock for finite seconds", () => {
    expect(formatDuration(90)).toBe("1:30");
  });
});

describe("totalRuntime", () => {
  test("sums durations, treating null as zero", () => {
    expect(totalRuntime([60, 120, null, 30])).toBe(210);
  });

  test("empty list is zero", () => {
    expect(totalRuntime([])).toBe(0);
  });
});
