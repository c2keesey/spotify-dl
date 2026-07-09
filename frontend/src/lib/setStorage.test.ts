import { beforeEach } from "vitest";
import { saveStored, loadStored, clearStored, resolveStored, type StoredEntry } from "@/lib/setStorage";
import type { DjTrack } from "@/lib/types";

const track = (id: string): DjTrack => ({
  id,
  title: `T${id}`,
  artist: "A",
  bpm: 128,
  key_name: null,
  camelot: "8A",
  genre: null,
  file_path: `/m/${id}.mp3`,
  file_state: "present",
  duration: 200,
  status: "analyzed",
  playlists: [],
});

beforeEach(() => clearStored());

it("round-trips {id, path} pairs and order through localStorage", () => {
  const entries: StoredEntry[] = [
    { id: "a", path: "/m/a.mp3" },
    { id: "b", path: "/m/b.mp3" },
  ];
  saveStored(entries);
  expect(loadStored()).toEqual(entries);
});

it("saving an empty set clears storage", () => {
  saveStored([{ id: "a", path: "/m/a.mp3" }]);
  saveStored([]);
  expect(loadStored()).toEqual([]);
  expect(localStorage.getItem("crate.set.v1")).toBeNull();
});

it("returns [] for absent or corrupt storage instead of throwing", () => {
  expect(loadStored()).toEqual([]);
  localStorage.setItem("crate.set.v1", "{not json");
  expect(loadStored()).toEqual([]);
  localStorage.setItem("crate.set.v1", JSON.stringify([{ id: "a" }, "junk", { path: "x" }]));
  expect(loadStored()).toEqual([]); // entries missing id or path are filtered out
});

it("resolves stored ids against the live library, dropping the unresolvable ones", () => {
  saveStored([
    { id: "a", path: "/m/a.mp3" },
    { id: "gone", path: "/m/gone.mp3" }, // track removed from rekordbox
    { id: "b", path: "/m/b.mp3" },
  ]);
  const byId = new Map([track("a"), track("b")].map((t) => [t.id, t]));
  const { tracks, dropped } = resolveStored(loadStored(), byId);
  expect(tracks.map((t) => t.id)).toEqual(["a", "b"]); // order preserved
  expect(dropped).toEqual([{ id: "gone", path: "/m/gone.mp3" }]);
});
