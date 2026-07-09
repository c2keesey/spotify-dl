import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DjTrack } from "@/lib/types";
import { clearStored, loadStored, resolveStored, saveStored, type StoredEntry } from "@/lib/setStorage";

const UNDO_LIMIT = 20;

type Store = {
  setIds: string[];
  cache: Record<string, DjTrack>;
  /** Bounded snapshot stack of prior orders, for undo. */
  past: string[][];
};

/**
 * The working set is a single module-level store (one in-progress set per the
 * spec) exposed through `useSyncExternalStore`, so every consumer — the browser
 * that adds, the rail that reorders, the undo/clear controls — shares one source
 * of truth without threading a provider through the page. The cache only ever
 * grows, so a set member stays resolvable even after the browser filters its row
 * away (the v1 lesson) and after an undo.
 */
let store: Store = { setIds: [], cache: {}, past: [] };
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function snapshot() {
  return store;
}
function emit() {
  for (const l of listeners) l();
}

function persist() {
  const entries: StoredEntry[] = store.setIds.map((id) => ({
    id,
    path: store.cache[id]?.file_path ?? "",
  }));
  saveStored(entries);
}

/** Commit a new state; `recordUndo` pushes the *prior* order onto the bounded stack. */
function commit(next: Partial<Store>, recordUndo: boolean) {
  let past = store.past;
  if (recordUndo) {
    past = [...store.past, store.setIds];
    if (past.length > UNDO_LIMIT) past = past.slice(past.length - UNDO_LIMIT);
  }
  store = { ...store, ...next, past };
  persist();
  emit();
}

function add(track: DjTrack) {
  const cache = { ...store.cache, [track.id]: track };
  if (store.setIds.includes(track.id)) {
    // Refresh the cached record but leave order/undo untouched.
    store = { ...store, cache };
    persist();
    emit();
    return;
  }
  commit({ setIds: [...store.setIds, track.id], cache }, true);
}

function remove(id: string) {
  if (!store.setIds.includes(id)) return;
  commit({ setIds: store.setIds.filter((x) => x !== id) }, true);
}

function reorder(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= store.setIds.length || to >= store.setIds.length) return;
  const setIds = [...store.setIds];
  const [moved] = setIds.splice(from, 1);
  setIds.splice(to, 0, moved);
  commit({ setIds }, true);
}

function clear() {
  if (store.setIds.length === 0) return;
  commit({ setIds: [] }, true);
  clearStored();
}

/** Undo touches membership/order only — never an export or a library import. */
function undo() {
  if (store.past.length === 0) return;
  const past = [...store.past];
  const prev = past.pop()!;
  store = { ...store, setIds: prev, past };
  persist();
  emit();
}

let restored = false;
async function ensureRestored() {
  if (restored) return;
  restored = true;
  const stored = loadStored();
  if (stored.length === 0) return;
  try {
    const { tracks } = await api.djTracks({});
    const byId = new Map(tracks.map((t) => [t.id, t] as const));
    const res = resolveStored(stored, byId);
    // Don't clobber a set the user began building while the fetch was in flight.
    if (store.setIds.length === 0 && res.tracks.length) {
      const cache = { ...store.cache };
      for (const t of res.tracks) cache[t.id] = t;
      store = { ...store, setIds: res.tracks.map((t) => t.id), cache };
      persist();
      emit();
    }
    if (res.dropped.length) {
      const n = res.dropped.length;
      toast.warning(`${n} saved track${n > 1 ? "s" : ""} no longer in your library — dropped from the set.`);
    }
  } catch {
    restored = false; // transient fetch failure: keep storage, retry on next mount
  }
}

function onKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (e.key !== "z" && e.key !== "Z") return;
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
  e.preventDefault();
  undo();
}
if (typeof window !== "undefined") window.addEventListener("keydown", onKey);

/** Reset the singleton between tests. */
export function __resetForTest() {
  store = { setIds: [], cache: {}, past: [] };
  restored = true;
  clearStored();
}

export function useSetState() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void ensureRestored();
  }, []);

  const tracks = s.setIds.map((id) => s.cache[id]).filter(Boolean);
  return {
    setIds: s.setIds,
    cache: s.cache,
    tracks,
    add,
    remove,
    reorder,
    clear,
    undo,
    canUndo: s.past.length > 0,
  };
}
