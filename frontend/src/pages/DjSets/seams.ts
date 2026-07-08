import type { Rating } from "@/lib/types";

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
