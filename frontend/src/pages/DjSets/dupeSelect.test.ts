import type { DjTrack, DupeGroup } from "@/lib/types";
import { defaultSelection, comparedSummary, groupKey } from "./dupeSelect";

function T(id: string, over: Partial<DjTrack> = {}): DjTrack {
  return {
    id, title: "Song", artist: "Artist", bpm: 124, key_name: "Am", camelot: "8A",
    genre: "House", file_path: `/lib/${id}.mp3`, file_state: "present",
    duration: 200, status: "analyzed", playlists: [], ...over,
  };
}

const exactGroup: DupeGroup = {
  reason: "exact_path",
  compared: { file_path: "/lib/a.mp3" },
  tracks: [T("1"), T("2"), T("3")],
};

const fuzzyGroup: DupeGroup = {
  reason: "fuzzy",
  compared: { artist: "Artist", title: "Song", norm_title: "song", duration: 200 },
  tracks: [T("4"), T("5")],
};

describe("defaultSelection", () => {
  it("preselects every copy but the first in an exact-path group", () => {
    const sel = defaultSelection([exactGroup]);
    expect([...sel].sort()).toEqual(["2", "3"]);
    expect(sel.has("1")).toBe(false); // one copy is always kept
  });

  it("NEVER preselects any copy in a fuzzy group", () => {
    const sel = defaultSelection([fuzzyGroup]);
    expect(sel.size).toBe(0);
    expect(sel.has("4")).toBe(false);
    expect(sel.has("5")).toBe(false);
  });

  it("mixed groups: only exact copies are preselected, no fuzzy id leaks in", () => {
    const sel = defaultSelection([exactGroup, fuzzyGroup]);
    expect([...sel].sort()).toEqual(["2", "3"]);
    for (const t of fuzzyGroup.tracks) expect(sel.has(t.id)).toBe(false);
  });

  it("returns an empty set for no groups", () => {
    expect(defaultSelection([]).size).toBe(0);
  });
});

describe("comparedSummary", () => {
  it("shows the shared path for an exact group", () => {
    expect(comparedSummary(exactGroup)).toBe("/lib/a.mp3");
  });
  it("shows artist/title/duration for a fuzzy group", () => {
    expect(comparedSummary(fuzzyGroup)).toBe("Artist — Song · ~200s");
  });
});

describe("groupKey", () => {
  it("is distinct per reason+index", () => {
    expect(groupKey(exactGroup, 0)).not.toBe(groupKey(fuzzyGroup, 0));
  });
});
