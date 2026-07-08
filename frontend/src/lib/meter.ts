export type Segment = "off" | "green" | "amber";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Pure VU-meter segmentation. `lit` segments fill from the left; the top of the
 * range (index >= floor(0.72 * count)) tips into amber, the rest are green.
 */
export function meterSegments(pct: number, count = 24): Segment[] {
  const lit = Math.round((clamp(pct, 0, 100) / 100) * count);
  const amberFrom = Math.floor(0.72 * count);
  return Array.from({ length: count }, (_, i) =>
    i < lit ? (i >= amberFrom ? "amber" : "green") : "off",
  );
}
