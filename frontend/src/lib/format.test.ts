import { formatClock, signedDelta, cumulativeStarts, totalRuntime } from "@/lib/format";

it("formats a clock as m:ss under an hour, dropping the zero hour", () => {
  expect(formatClock(0)).toBe("0:00");
  expect(formatClock(65)).toBe("1:05");
  expect(formatClock(31 * 60 + 40)).toBe("31:40");
});

it("formats a clock as h:mm:ss once it passes an hour", () => {
  expect(formatClock(3600)).toBe("1:00:00");
  expect(formatClock(3661)).toBe("1:01:01");
  expect(formatClock(2 * 3600 + 5 * 60 + 9)).toBe("2:05:09");
});

it("never emits a negative clock", () => {
  expect(formatClock(-30)).toBe("0:00");
});

it("signs BPM deltas and trims a trailing .0", () => {
  expect(signedDelta(6)).toBe("+6");
  expect(signedDelta(-1.5)).toBe("-1.5");
  expect(signedDelta(0)).toBe("±0");
  expect(signedDelta(2.0)).toBe("+2");
});

it("cumulative starts: slot i begins after all prior durations", () => {
  // 7 tracks of ~4:32 each => slot 7 (index 6) begins at 6 * 272 = 27:12.
  const starts = cumulativeStarts([272, 272, 272, 272, 272, 272, 272]);
  expect(starts[0]).toBe(0);
  expect(starts[6]).toBe(272 * 6);
  expect(formatClock(starts[6])).toBe("27:12");
});

it("treats an unknown (null) duration as zero in the running clock and total", () => {
  const durations = [200, null, 100];
  expect(cumulativeStarts(durations)).toEqual([0, 200, 200]);
  expect(totalRuntime(durations)).toBe(300);
});
