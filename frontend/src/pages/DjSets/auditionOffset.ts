import type { FileState } from "@/lib/types";

/**
 * Where auditioning starts inside a track. Intros rarely carry the identifying
 * part of a song — she's trying to *recognize* it — so playback drops in about a
 * third of the way through rather than at 0:00. A named constant, not a magic
 * number buried in the player.
 */
export const AUDITION_OFFSET_FRACTION = 1 / 3;

/**
 * Below this many seconds a track is too short for a third-in drop to be worth
 * it (or the duration is unknown), so we just start at the top.
 */
export const AUDITION_MIN_DURATION_S = 30;

/** Seconds into `duration` at which auditioning should begin. */
export function auditionStartTime(duration: number | null | undefined): number {
  if (duration == null || duration < AUDITION_MIN_DURATION_S) return 0;
  return duration * AUDITION_OFFSET_FRACTION;
}

/**
 * Whether a track can be auditioned at all. Only a file actually present on disk
 * can stream — 926 of the 1437-track library are `missing`, so this is the
 * common gate, not the edge case. The play control is unavailable for anything
 * that is not `present` before she even clicks.
 */
export function canAudition(state: FileState): boolean {
  return state === "present";
}
