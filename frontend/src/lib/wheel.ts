/**
 * Camelot wheel geometry — a faithful port of the v1 SVG math (`wheelArc` /
 * `renderWheel` in the legacy `static/index.html`). Angles run clockwise from
 * 12 o'clock: `x = cx + r·sin(a)`, `y = cy − r·cos(a)`. Two concentric rings
 * (A inner, B outer) each carry 12 wedge segments; chord nodes sit on their own
 * radii so the harmonic-move arrows read cleanly inside the labels.
 */
export const WHEEL_SIZE = 260;
const CENTER = WHEEL_SIZE / 2; // 130
const SEG = (2 * Math.PI) / 12;

/** [inner, outer] radius per ring. */
const RING_RADII: Record<Ring, [number, number]> = {
  A: [52, 88],
  B: [90, 126],
};
/** Radius the chord (arrow) nodes sit on, per ring. */
const CHORD_RADIUS: Record<Ring, number> = { A: 70, B: 108 };

export type Ring = "A" | "B";

/** Point on the wheel at radius `r`, angle `a` (clockwise from 12 o'clock). */
function point(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/**
 * SVG path for one ring segment spanning angles `a0`→`a1` between radii
 * `r0` (inner) and `r1` (outer). Sweeps the outer arc clockwise, cuts in, and
 * sweeps the inner arc back — exactly the v1 string so snapshot math holds.
 */
export function wheelArc(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const [x0, y0] = point(cx, cy, r1, a0);
  const [x1, y1] = point(cx, cy, r1, a1);
  const [x2, y2] = point(cx, cy, r0, a1);
  const [x3, y3] = point(cx, cy, r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

export type SegmentGeometry = {
  path: string;
  labelX: number;
  labelY: number;
  chordX: number;
  chordY: number;
};

/**
 * Geometry for the Camelot segment `n` (1..12) on `ring`: its wedge `path`, the
 * label anchor at the ring's radial mid, and the chord node used to draw
 * harmonic-move arrows between consecutive tracks.
 */
export function segmentGeometry(n: number, ring: Ring): SegmentGeometry {
  const a0 = (n - 1) * SEG - SEG / 2;
  const a1 = a0 + SEG;
  const [r0, r1] = RING_RADII[ring];
  const path = wheelArc(CENTER, CENTER, r0, r1, a0, a1);

  const mid = (a0 + a1) / 2;
  const rm = (r0 + r1) / 2;
  const [labelX, labelY] = point(CENTER, CENTER, rm, mid);

  const chordAngle = (n - 1) * SEG;
  const [chordX, chordY] = point(CENTER, CENTER, CHORD_RADIUS[ring], chordAngle);

  return { path, labelX, labelY, chordX, chordY };
}

/** Chord node for a Camelot `code` (e.g. "9A") — where its arrow endpoint sits. */
export function chordNode(code: string): [number, number] {
  const n = parseInt(code, 10);
  const ring: Ring = code.endsWith("A") ? "A" : "B";
  const { chordX, chordY } = segmentGeometry(n, ring);
  return [chordX, chordY];
}
