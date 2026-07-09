import { act, renderHook } from "@testing-library/react";
import type { DjTrack } from "@/lib/types";
import { useSetState } from "./useSetState";

const track = (id: string, over: Partial<DjTrack> = {}): DjTrack => ({
  id,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  bpm: 128,
  key_name: "A min",
  camelot: "8A",
  genre: "House",
  file_path: `/music/${id}.mp3`,
  file_state: "present",
  duration: 200,
  status: "analyzed",
  playlists: [],
  ...over,
});

it("adds tracks and dedupes by id", () => {
  const { result } = renderHook(() => useSetState());
  act(() => result.current.add(track("a")));
  act(() => result.current.add(track("a")));
  act(() => result.current.add(track("b")));
  expect(result.current.setIds).toEqual(["a", "b"]);
  expect(result.current.tracks.map((t) => t.id)).toEqual(["a", "b"]);
});

it("removes a track by id (leaving the cache intact)", () => {
  const { result } = renderHook(() => useSetState());
  act(() => result.current.add(track("a")));
  act(() => result.current.add(track("b")));
  act(() => result.current.remove("a"));
  expect(result.current.setIds).toEqual(["b"]);
  expect(result.current.cache["a"]).toBeTruthy(); // still cached
});

it("reorder(0, 2) moves the first track to third", () => {
  const { result } = renderHook(() => useSetState());
  act(() => result.current.add(track("a")));
  act(() => result.current.add(track("b")));
  act(() => result.current.add(track("c")));
  act(() => result.current.reorder(0, 2));
  expect(result.current.setIds).toEqual(["b", "c", "a"]);
});

it("keeps set tracks resolvable after the source record is gone (cache survival)", () => {
  const { result } = renderHook(() => useSetState());
  // Simulate the track being visible in the browser only at add-time.
  act(() => result.current.add(track("a", { title: "Ephemeral" })));
  // A later browser filter would drop the row, but the set still resolves it.
  expect(result.current.tracks).toHaveLength(1);
  expect(result.current.tracks[0].title).toBe("Ephemeral");
});
