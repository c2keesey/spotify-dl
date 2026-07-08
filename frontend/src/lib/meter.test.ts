import { meterSegments } from "@/lib/meter";

test("0% all off", () => expect(meterSegments(0, 10).every((s) => s === "off")).toBe(true));

test("100% fills with amber tip", () => {
  const s = meterSegments(100, 10);
  expect(s.filter((x) => x === "green").length).toBe(7);
  expect(s.filter((x) => x === "amber").length).toBe(3);
  expect(s.includes("off")).toBe(false);
});

test("50% of 10 lights 5, all green (below 72% threshold)", () => {
  const s = meterSegments(50, 10);
  expect(s.filter((x) => x !== "off").length).toBe(5);
  expect(s.includes("amber")).toBe(false);
});

test("clamps out-of-range", () => {
  expect(meterSegments(-5, 10).every((s) => s === "off")).toBe(true);
  expect(meterSegments(250, 10).filter((s) => s !== "off").length).toBe(10);
});
