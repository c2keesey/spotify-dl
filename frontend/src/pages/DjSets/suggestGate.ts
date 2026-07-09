import type { DjTrack } from "@/lib/types";

/**
 * Whether the working set can produce next-track suggestions, and — when it
 * can't — the plain-language reason to show in the panel instead of a blank.
 * Suggestions rank the library against the set's LAST slot, so the gate turns
 * on that slot alone: an empty set has nothing to build on, and a last slot
 * rekordbox hasn't keyed/tempo-analyzed gives nothing to match against. Pure and
 * testable; the panel derives its empty state from this, never from a bare null.
 */
export type SuggestGate = { canSuggest: true } | { canSuggest: false; reason: string };

export function suggestGate(tracks: DjTrack[]): SuggestGate {
  const last = tracks[tracks.length - 1];
  if (!last) {
    return {
      canSuggest: false,
      reason: "Add a track to your set and Crate will suggest what could play next after it.",
    };
  }
  const missing: string[] = [];
  if (!last.camelot) missing.push("key");
  if (last.bpm == null) missing.push("BPM");
  if (missing.length > 0) {
    return {
      canSuggest: false,
      reason: `"${last.title}" has no ${missing.join(" or ")} yet, so there's nothing to match the next track against. Let rekordbox analyze it first.`,
    };
  }
  return { canSuggest: true };
}
