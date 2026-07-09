/**
 * Pure logic for the set library, kept out of the component so the two rules
 * that matter — a forked playlist never silently loses tracks, and opening a set
 * always says when resolution was imperfect — are unit-tested in isolation.
 */
import type { DjTrack, OpenSet, RekordboxPlaylist } from "@/lib/types";

/** Resolve a rekordbox playlist's ordered ids against the live collection into
 *  DjTracks the rail can hold. Any id the collection no longer has (e.g. sampler
 *  content) is reported as dropped, never silently omitted. */
export function forkFromPlaylist(
  playlist: RekordboxPlaylist,
  byId: Map<string, DjTrack>,
): { tracks: DjTrack[]; dropped: string[] } {
  const tracks: DjTrack[] = [];
  const dropped: string[] = [];
  for (const id of playlist.track_ids) {
    const t = byId.get(id);
    if (t) tracks.push(t);
    else dropped.push(id);
  }
  return { tracks, dropped };
}

/** A plain-language note when opening a set resolved imperfectly, or null when
 *  every track resolved cleanly by id. The UI shows this so a short set is never
 *  presented without explanation. */
export function openResolutionNote(
  res: Pick<OpenSet, "path_resolved" | "unresolved">,
): string | null {
  const pr = res.path_resolved.length;
  const un = res.unresolved.length;
  if (!pr && !un) return null;
  const parts: string[] = [];
  if (pr) parts.push(`${pr} track${pr > 1 ? "s" : ""} matched by file path (content id changed)`);
  if (un) parts.push(`${un} track${un > 1 ? "s" : ""} could not be found and ${un > 1 ? "were" : "was"} left out`);
  return parts.join("; ") + ".";
}
