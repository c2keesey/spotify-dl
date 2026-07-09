import {
  AUDITION_MIN_DURATION_S,
  AUDITION_OFFSET_FRACTION,
  auditionStartTime,
  canAudition,
} from "./auditionOffset";

it("drops in about a third of the way through a normal-length track", () => {
  expect(auditionStartTime(300)).toBeCloseTo(300 * AUDITION_OFFSET_FRACTION);
  expect(auditionStartTime(180)).toBeCloseTo(60);
});

it("starts at the top when the duration is unknown", () => {
  expect(auditionStartTime(null)).toBe(0);
  expect(auditionStartTime(undefined)).toBe(0);
});

it("starts at the top for a track too short to bother seeking into", () => {
  expect(auditionStartTime(AUDITION_MIN_DURATION_S - 1)).toBe(0);
  expect(auditionStartTime(5)).toBe(0);
});

it("only allows auditioning a file that is actually present on disk", () => {
  expect(canAudition("present")).toBe(true);
  expect(canAudition("missing")).toBe(false);
  expect(canAudition("unmounted")).toBe(false);
  expect(canAudition("not_a_file")).toBe(false);
});
