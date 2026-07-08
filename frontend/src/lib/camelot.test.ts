import { camelotColor, CAMELOT_CODES } from "./camelot";

it("colors the A ring darker (lightness 38)", () => {
  expect(camelotColor("8A")).toBe("hsl(210 65% 38% / 0.85)");
});

it("colors the B ring brighter (lightness 52)", () => {
  expect(camelotColor("8B")).toBe("hsl(210 65% 52% / 0.85)");
});

it("maps hue from the code number", () => {
  expect(camelotColor("1A")).toBe("hsl(0 65% 38% / 0.85)");
  expect(camelotColor("12B")).toBe("hsl(330 65% 52% / 0.85)");
});

it("falls back to the muted token for a null code", () => {
  expect(camelotColor(null)).toBe("hsl(var(--muted))");
});

it("lists 24 interleaved codes starting 1A,1B", () => {
  expect(CAMELOT_CODES).toHaveLength(24);
  expect(CAMELOT_CODES.slice(0, 4)).toEqual(["1A", "1B", "2A", "2B"]);
  expect(CAMELOT_CODES[23]).toBe("12B");
});
