import type { Cue } from "@/lib/types";

/**
 * The loop engine's single decision, extracted for tests: should the playhead
 * wrap back to the loop start this frame? Only a cue with an end (a loop)
 * wraps, and only once the playhead has reached it.
 */
export function shouldWrap(currentTime: number, loop: Cue | null | undefined): boolean {
  if (!loop || loop.end === null) return false;
  return currentTime >= loop.end;
}
