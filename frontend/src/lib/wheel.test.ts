import { wheelArc, segmentGeometry, WHEEL_SIZE } from "./wheel";

it("builds a segment arc path with both ring radii (v1 math)", () => {
  const d = wheelArc(130, 130, 52, 88, -Math.PI / 12, Math.PI / 12);
  // outer ring sweep then inner ring sweep back
  expect(d).toContain("A88,88");
  expect(d).toContain("A52,52");
  expect(d.startsWith("M")).toBe(true);
  expect(d.endsWith("Z")).toBe(true);
});

it("exposes the v1 canvas size of 260", () => {
  expect(WHEEL_SIZE).toBe(260);
});

it("places the 1A chord node at the 12-o'clock inner radius (130, 130-70)", () => {
  const g = segmentGeometry(1, "A");
  expect(g.chordX).toBeCloseTo(130, 6);
  expect(g.chordY).toBeCloseTo(60, 6);
});

it("places the 1B chord node further out at radius 108 (130, 130-108)", () => {
  const g = segmentGeometry(1, "B");
  expect(g.chordX).toBeCloseTo(130, 6);
  expect(g.chordY).toBeCloseTo(22, 6);
});

it("labels the 1A segment at the radial mid of the A ring", () => {
  const g = segmentGeometry(1, "A");
  // A ring mid radius = (52+88)/2 = 70, at 12 o'clock
  expect(g.labelX).toBeCloseTo(130, 6);
  expect(g.labelY).toBeCloseTo(60, 6);
});

it("returns a path matching wheelArc for the segment's angular span", () => {
  const g = segmentGeometry(1, "A");
  const seg = (2 * Math.PI) / 12;
  const a0 = -seg / 2;
  expect(g.path).toBe(wheelArc(130, 130, 52, 88, a0, a0 + seg));
});
