import {
  camelotRank,
  distinctGenres,
  filterTracks,
  formatDuration,
  normalizeTrack,
  sortTracks,
  type BrowserTrack,
} from "./trackSort";

/** Build a BrowserTrack with sensible defaults; override what a test cares about. */
function track(o: Partial<BrowserTrack> & { id: string }): BrowserTrack {
  return {
    id: o.id,
    title: o.title ?? "title",
    artist: o.artist ?? "artist",
    bpm: o.bpm ?? null,
    key_name: o.key_name ?? null,
    camelot: o.camelot ?? null,
    file_path: o.file_path ?? "/x.mp3",
    duration: o.duration ?? null,
    status: o.status ?? "analyzed",
    playlists: o.playlists ?? [],
    genre: o.genre ?? null,
    file_state: o.file_state ?? "present",
  };
}

describe("normalizeTrack", () => {
  it("defaults the Wave 1 fields when the backend omits them", () => {
    // A raw DjTrack with no genre/file_state, as the pre-Wave-1 API returns.
    const raw = {
      id: "1",
      title: "t",
      artist: "a",
      bpm: null,
      key_name: null,
      camelot: null,
      file_path: "/x",
      duration: null,
      status: "analyzed" as const,
      playlists: [],
    };
    const n = normalizeTrack(raw);
    expect(n.genre).toBeNull();
    expect(n.file_state).toBe("present");
  });

  it("passes through backend-provided fields and rejects a bogus file_state", () => {
    expect(normalizeTrack(track({ id: "1", genre: "Techno", file_state: "missing" })).file_state).toBe("missing");
    // @ts-expect-error — exercising runtime coercion of an invalid value
    expect(normalizeTrack(track({ id: "2", file_state: "bogus" })).file_state).toBe("present");
  });
});

describe("camelotRank", () => {
  it("orders 1A < 1B < 2A and returns null for unkeyed/invalid", () => {
    expect(camelotRank("1A")).toBe(2);
    expect(camelotRank("1B")).toBe(3);
    expect(camelotRank("2A")).toBe(4);
    expect(camelotRank("12B")).toBe(25);
    expect(camelotRank(null)).toBeNull();
    expect(camelotRank("spotify")).toBeNull();
  });
});

describe("sortTracks", () => {
  it("sorts BPM ascending and descending", () => {
    const ts = [track({ id: "a", bpm: 128 }), track({ id: "b", bpm: 120 }), track({ id: "c", bpm: 174 })];
    expect(sortTracks(ts, "bpm", "asc").map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(sortTracks(ts, "bpm", "desc").map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps null values last in BOTH directions", () => {
    const ts = [track({ id: "a", bpm: 128 }), track({ id: "n", bpm: null }), track({ id: "b", bpm: 120 })];
    expect(sortTracks(ts, "bpm", "asc").map((t) => t.id)).toEqual(["b", "a", "n"]);
    expect(sortTracks(ts, "bpm", "desc").map((t) => t.id)).toEqual(["a", "b", "n"]);
  });

  it("sorts title case-insensitively", () => {
    const ts = [track({ id: "a", title: "zebra" }), track({ id: "b", title: "Apple" })];
    expect(sortTracks(ts, "title", "asc").map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("sorts key by Camelot rank, unkeyed last", () => {
    const ts = [
      track({ id: "a", camelot: "8A" }),
      track({ id: "n", camelot: null }),
      track({ id: "b", camelot: "1B" }),
    ];
    expect(sortTracks(ts, "key", "asc").map((t) => t.id)).toEqual(["b", "a", "n"]);
  });

  it("does not mutate the input array", () => {
    const ts = [track({ id: "a", bpm: 2 }), track({ id: "b", bpm: 1 })];
    sortTracks(ts, "bpm", "asc");
    expect(ts.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("filterTracks composition", () => {
  const lib = [
    track({ id: "keep", genre: "Techno", duration: 300, status: "analyzed", file_state: "present" }),
    track({ id: "wrongGenre", genre: "House", duration: 300, status: "analyzed", file_state: "present" }),
    track({ id: "tooShort", genre: "Techno", duration: 60, status: "analyzed", file_state: "present" }),
    track({ id: "pending", genre: "Techno", duration: 300, status: "pending", file_state: "present" }),
    track({ id: "missing", genre: "Techno", duration: 300, status: "analyzed", file_state: "missing" }),
    track({ id: "noDur", genre: "Techno", duration: null, status: "analyzed", file_state: "present" }),
  ];

  it("AND-composes every filter down to the one matching track", () => {
    const out = filterTracks(lib, {
      genre: "Techno",
      durMin: 120,
      durMax: null,
      analyzedOnly: true,
      fileState: "present",
    });
    expect(out.map((t) => t.id)).toEqual(["keep"]);
  });

  it("excludes rows with unknown duration when a duration bound is set", () => {
    const out = filterTracks(lib, { genre: null, durMin: 120, durMax: null, analyzedOnly: false, fileState: "any" });
    expect(out.map((t) => t.id)).not.toContain("noDur");
  });

  it("'any' file state and no bounds is a pass-through", () => {
    const out = filterTracks(lib, { genre: null, durMin: null, durMax: null, analyzedOnly: false, fileState: "any" });
    expect(out).toHaveLength(lib.length);
  });

  it("file-state filter isolates unmounted from missing", () => {
    const drives = [
      track({ id: "m", file_state: "missing" }),
      track({ id: "u", file_state: "unmounted" }),
    ];
    expect(filterTracks(drives, { genre: null, durMin: null, durMax: null, analyzedOnly: false, fileState: "unmounted" }).map((t) => t.id)).toEqual(["u"]);
  });
});

describe("presentation helpers", () => {
  it("lists distinct genres alphabetically, ignoring blanks", () => {
    const ts = [track({ id: "1", genre: "Techno" }), track({ id: "2", genre: "House" }), track({ id: "3", genre: "Techno" }), track({ id: "4", genre: null })];
    expect(distinctGenres(ts)).toEqual(["House", "Techno"]);
  });

  it("formats seconds as m:ss", () => {
    expect(formatDuration(214)).toBe("3:34");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(null)).toBe("");
  });
});
