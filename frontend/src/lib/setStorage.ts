import type { DjTrack } from "@/lib/types";

/**
 * Autosave for the single in-progress set. We persist only `{id, path}` per
 * slot plus order — the id resolves against the live rekordbox library on
 * restore, and a stored id that no longer resolves is dropped (with a note),
 * never crashed on. No naming, no multiple sets, no filesystem.
 */
export type StoredEntry = { id: string; path: string };

const KEY = "crate.set.v1";

export function saveStored(entries: StoredEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — autosave is best-effort, never fatal */
  }
}

export function loadStored(): StoredEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.id === "string" && typeof e.path === "string")
      .map((e) => ({ id: e.id as string, path: e.path as string }));
  } catch {
    return [];
  }
}

export function clearStored(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Split stored entries into the ones the live library still resolves and the
 *  ones it does not (track removed from rekordbox), preserving stored order. */
export function resolveStored(
  stored: StoredEntry[],
  byId: Map<string, DjTrack>,
): { tracks: DjTrack[]; dropped: StoredEntry[] } {
  const tracks: DjTrack[] = [];
  const dropped: StoredEntry[] = [];
  for (const e of stored) {
    const t = byId.get(e.id);
    if (t) tracks.push(t);
    else dropped.push(e);
  }
  return { tracks, dropped };
}
