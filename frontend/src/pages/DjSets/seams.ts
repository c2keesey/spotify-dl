import type { Rating } from "@/lib/types";
import { signedDelta } from "@/lib/format";

/**
 * The seam that sits *between* track i and track i+1 is `ratings[i]`. This pins
 * the alignment contract: for N tracks there are N-1 seams, and a compatibility
 * `ratings` array is exactly that gap list. Out-of-range (the trailing edge
 * after the last track, or a negative index) has no seam → null.
 */
export function seamFor(ratings: Rating[], i: number): Rating | null {
  if (i < 0 || i >= ratings.length) return null;
  return ratings[i];
}

const RELATION: Record<Rating, string> = {
  good: "Harmonic + tempo match",
  ok: "Workable — watch the blend",
  clash: "Key or tempo clash",
};

/**
 * Text the seam tooltip announces on hover *and* keyboard focus, so color is no
 * longer the sole carrier of meaning: the relation, both Camelot keys, and the
 * BPM delta of the transition.
 */
export function seamTooltip(
  rating: Rating,
  fromCamelot: string | null,
  toCamelot: string | null,
  bpmDelta: number | null,
): string {
  const keys = `${fromCamelot ?? "—"} → ${toCamelot ?? "—"}`;
  const delta = bpmDelta == null ? "BPM —" : `${signedDelta(bpmDelta)} BPM`;
  return `${RELATION[rating]} · ${keys} · ${delta}`;
}
