import { act, renderHook } from "@testing-library/react";
import { beforeEach } from "vitest";
import type { DjTrack } from "@/lib/types";
import { useSetState, __resetForTest } from "./useSetState";

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

beforeEach(() => __resetForTest());

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
  act(() => result.current.add(track("a", { title: "Ephemeral" })));
  expect(result.current.tracks).toHaveLength(1);
  expect(result.current.tracks[0].title).toBe("Ephemeral");
});

it("undo reverses add / remove / reorder / clear, one step at a time", () => {
  const { result } = renderHook(() => useSetState());
  act(() => result.current.add(track("a")));
  act(() => result.current.add(track("b")));
  act(() => result.current.reorder(0, 1)); // -> [b, a]
  expect(result.current.setIds).toEqual(["b", "a"]);
  act(() => result.current.undo()); // undo reorder -> [a, b]
  expect(result.current.setIds).toEqual(["a", "b"]);
  act(() => result.current.clear()); // -> []
  expect(result.current.setIds).toEqual([]);
  act(() => result.current.undo()); // undo clear -> [a, b]
  expect(result.current.setIds).toEqual(["a", "b"]);
});

it("bounds the undo stack at 20 steps", () => {
  const { result } = renderHook(() => useSetState());
  // 25 adds => 25 undo-able steps, but the stack only keeps the last 20.
  for (let i = 0; i < 25; i++) act(() => result.current.add(track(`t${i}`)));
  expect(result.current.setIds).toHaveLength(25);
  for (let i = 0; i < 25; i++) act(() => result.current.undo());
  // Only 20 undos land; the 5 oldest steps are unreachable.
  expect(result.current.canUndo).toBe(false);
  expect(result.current.setIds).toHaveLength(5);
});

it("clear is a no-op with nothing to undo when the set is already empty", () => {
  const { result } = renderHook(() => useSetState());
  act(() => result.current.clear());
  expect(result.current.canUndo).toBe(false);
  expect(result.current.setIds).toEqual([]);
});
