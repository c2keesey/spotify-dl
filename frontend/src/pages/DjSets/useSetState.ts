import { useMemo, useReducer } from "react";
import type { DjTrack } from "@/lib/types";

type State = { setIds: string[]; cache: Record<string, DjTrack> };
type Action =
  | { type: "add"; track: DjTrack }
  | { type: "remove"; id: string }
  | { type: "reorder"; from: number; to: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "add": {
      const { track } = action;
      // Always cache the record — the v1 lesson: a track added to the set must
      // survive the browser being filtered away from it.
      const cache = { ...state.cache, [track.id]: track };
      const setIds = state.setIds.includes(track.id)
        ? state.setIds
        : [...state.setIds, track.id];
      return { setIds, cache };
    }
    case "remove":
      return { ...state, setIds: state.setIds.filter((id) => id !== action.id) };
    case "reorder": {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= state.setIds.length || to >= state.setIds.length) {
        return state;
      }
      const setIds = [...state.setIds];
      const [moved] = setIds.splice(from, 1);
      setIds.splice(to, 0, moved);
      return { ...state, setIds };
    }
    default:
      return state;
  }
}

/**
 * Working DJ set state: an ordered list of track ids plus a cache of every
 * record ever added, so the set stays resolvable even after the track browser
 * filters those rows out. `tracks` maps the ordered ids back through the cache.
 */
export function useSetState() {
  const [state, dispatch] = useReducer(reducer, { setIds: [], cache: {} });

  const tracks = useMemo(
    () => state.setIds.map((id) => state.cache[id]).filter(Boolean),
    [state.setIds, state.cache],
  );

  return {
    setIds: state.setIds,
    cache: state.cache,
    tracks,
    add: (track: DjTrack) => dispatch({ type: "add", track }),
    remove: (id: string) => dispatch({ type: "remove", id }),
    reorder: (from: number, to: number) => dispatch({ type: "reorder", from, to }),
  };
}
