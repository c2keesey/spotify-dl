import type { DjTrack, FileState } from "./types";

// --- Sorting -----------------------------------------------------------------

export type SortKey = "title" | "artist" | "bpm" | "key" | "genre" | "duration";
export type SortDir = "asc" | "desc";

/**
 * Order a Camelot code for sorting: 1A < 1B < 2A < … < 12B. Null/invalid → null
 * so unkeyed tracks sort last. `8A` → 16, `8B` → 17.
 */
export function camelotRank(code: string | null): number | null {
  if (!code) return null;
  const m = /^(\d{1,2})([AB])$/.exec(code.trim());
  if (!m) return null;
  return Number(m[1]) * 2 + (m[2] === "B" ? 1 : 0);
}

const str = (s: string | null): string | null =>
  s && s.trim() !== "" ? s.trim().toLowerCase() : null;

const VALUE: Record<SortKey, (t: DjTrack) => number | string | null> = {
  title: (t) => str(t.title),
  artist: (t) => str(t.artist),
  genre: (t) => str(t.genre),
  bpm: (t) => t.bpm,
  duration: (t) => t.duration,
  key: (t) => camelotRank(t.camelot),
};

/**
 * Sort a copy of `tracks` by `key`/`dir`. Null values always sort last,
 * regardless of direction — reversing the sort must not float blanks to the top.
 */
export function sortTracks(tracks: DjTrack[], key: SortKey, dir: SortDir): DjTrack[] {
  const get = VALUE[key];
  const mul = dir === "asc" ? 1 : -1;
  return [...tracks].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last in both directions
    if (bv == null) return -1;
    const base =
      typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return base * mul;
  });
}

// --- Filtering ---------------------------------------------------------------

export type FileStateFilter = FileState | "any";

export type TrackFilters = {
  /** Exact genre match; null = any. */
  genre: string | null;
  /** Duration bounds in seconds; null = unbounded. */
  durMin: number | null;
  durMax: number | null;
  /** Only rows the backend has finished analyzing. */
  analyzedOnly: boolean;
  fileState: FileStateFilter;
};

/**
 * Compose the client-side filters (genre, duration range, analyzed-only, file
 * state) over the already server-filtered list (q / BPM / Camelot). Every filter
 * is AND-ed. A duration bound excludes rows with no known duration.
 */
export function filterTracks(tracks: DjTrack[], f: TrackFilters): DjTrack[] {
  return tracks.filter((t) => {
    if (f.genre != null && (t.genre ?? "") !== f.genre) return false;
    if (f.analyzedOnly && t.status !== "analyzed") return false;
    if (f.fileState !== "any" && t.file_state !== f.fileState) return false;
    if (f.durMin != null && (t.duration == null || t.duration < f.durMin)) return false;
    if (f.durMax != null && (t.duration == null || t.duration > f.durMax)) return false;
    return true;
  });
}

// --- Presentation helpers ----------------------------------------------------

/** Distinct non-empty genres in the list, alphabetized — feeds the genre filter. */
export function distinctGenres(tracks: DjTrack[]): string[] {
  const set = new Set<string>();
  for (const t of tracks) if (t.genre && t.genre.trim()) set.add(t.genre);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type FileStateMeta = { label: string; short: string; className: string };

/**
 * Label + accent for a non-present file state, or null when the file is present
 * (no badge). The meaning is carried by `short`/`label` text, never color alone.
 */
export function fileStateMeta(state: FileState): FileStateMeta | null {
  switch (state) {
    case "missing":
      return { label: "File missing — moved or deleted", short: "missing", className: "text-destructive" };
    case "unmounted":
      return {
        label: "Volume not mounted — external drive disconnected",
        short: "unmounted",
        className: "text-vfd",
      };
    case "not_a_file":
      return { label: "Streaming entry — no local file", short: "streaming", className: "text-muted-foreground" };
    default:
      return null;
  }
}
