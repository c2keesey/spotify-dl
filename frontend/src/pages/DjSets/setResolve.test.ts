import type { DjTrack, RekordboxPlaylist } from "@/lib/types";
import { forkFromPlaylist, openResolutionNote } from "./setResolve";

const track = (id: string): DjTrack => ({
  id, title: `T${id}`, artist: `A${id}`, bpm: 128, key_name: "A min", camelot: "8A",
  genre: "House", file_path: `/m/${id}.mp3`, file_state: "present", duration: 200,
  status: "analyzed", playlists: [],
});

const playlist = (track_ids: string[]): RekordboxPlaylist => ({
  id: "p1", name: "PL", track_count: track_ids.length, track_ids,
});

describe("forkFromPlaylist", () => {
  it("resolves ids in order and reports the ones the library lost", () => {
    const byId = new Map([["1", track("1")], ["3", track("3")]]);
    const { tracks, dropped } = forkFromPlaylist(playlist(["1", "2", "3"]), byId);
    expect(tracks.map((t) => t.id)).toEqual(["1", "3"]); // order preserved
    expect(dropped).toEqual(["2"]);                       // gone, not silently omitted
  });

  it("resolves nothing (all dropped) without throwing", () => {
    const { tracks, dropped } = forkFromPlaylist(playlist(["9"]), new Map());
    expect(tracks).toEqual([]);
    expect(dropped).toEqual(["9"]);
  });
});

describe("openResolutionNote", () => {
  it("is null when every track resolved cleanly by id", () => {
    expect(openResolutionNote({ path_resolved: [], unresolved: [] })).toBeNull();
  });

  it("names path-only matches", () => {
    const note = openResolutionNote({
      path_resolved: [{ id: "1", path: "/m/a.mp3", resolved_id: "9" }],
      unresolved: [],
    });
    expect(note).toContain("matched by file path");
  });

  it("names left-out tracks", () => {
    const note = openResolutionNote({
      path_resolved: [],
      unresolved: [{ id: "1", path: "/m/a.mp3" }, { id: "2", path: "/m/b.mp3" }],
    });
    expect(note).toContain("2 tracks");
    expect(note).toContain("left out");
  });
});
