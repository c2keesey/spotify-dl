import type { DjTrack } from "@/lib/types";
import { suggestGate } from "./suggestGate";

const T = (over: Partial<DjTrack> = {}): DjTrack => ({
  id: "1",
  title: "Song",
  artist: "Artist",
  bpm: 124,
  key_name: "Am",
  camelot: "8A",
  genre: null,
  file_path: "/lib/a.mp3",
  file_state: "present",
  duration: 200,
  status: "analyzed",
  playlists: [],
  ...over,
});

describe("suggestGate", () => {
  it("blocks an empty set and explains how to get suggestions", () => {
    const g = suggestGate([]);
    expect(g.canSuggest).toBe(false);
    if (!g.canSuggest) expect(g.reason.toLowerCase()).toContain("add");
  });

  it("allows suggestions when the last track has both key and BPM", () => {
    expect(suggestGate([T()]).canSuggest).toBe(true);
  });

  it("gates on the LAST slot only — earlier scoreable tracks don't matter", () => {
    const g = suggestGate([
      T({ id: "1" }),
      T({ id: "2", camelot: null, key_name: null, status: "pending" }),
    ]);
    expect(g.canSuggest).toBe(false);
    if (!g.canSuggest) expect(g.reason.toLowerCase()).toContain("key");
  });

  it("names BPM as the missing dimension when only BPM is absent", () => {
    const g = suggestGate([T({ bpm: null, status: "pending" })]);
    expect(g.canSuggest).toBe(false);
    if (!g.canSuggest) {
      expect(g.reason.toLowerCase()).toContain("bpm");
      expect(g.reason).toContain("Song");
    }
  });

  it("names both when key and BPM are absent, so the panel is never blank", () => {
    const g = suggestGate([T({ camelot: null, key_name: null, bpm: null, status: "pending" })]);
    expect(g.canSuggest).toBe(false);
    if (!g.canSuggest) {
      expect(g.reason.toLowerCase()).toContain("key");
      expect(g.reason.toLowerCase()).toContain("bpm");
    }
  });
});
