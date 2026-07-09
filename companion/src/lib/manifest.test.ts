import { parseManifest } from "@/lib/manifest";

function validTrack(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Song",
    artist: "Artist",
    bpm: 128,
    key_name: "A min",
    camelot: "8A",
    genre: "House",
    duration: 200,
    audio: "t1.mp3",
    peaks: "t1.peaks",
    peaks_rate: 200,
    ...over,
  };
}

function validManifest(over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    set: "my-set",
    name: "My Set",
    created_at: "2026-07-09T00:00:00.000Z",
    order: ["t1"],
    tracks: [validTrack()],
    ...over,
  };
}

describe("parseManifest — accept", () => {
  test("returns a typed manifest for a valid input", () => {
    const m = parseManifest(validManifest());
    expect(m.schema).toBe(1);
    expect(m.set).toBe("my-set");
    expect(m.name).toBe("My Set");
    expect(m.order).toEqual(["t1"]);
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0].id).toBe("t1");
    expect(m.tracks[0].peaks_rate).toBe(200);
  });

  test("accepts null bpm and null duration", () => {
    const m = parseManifest(validManifest({ tracks: [validTrack({ bpm: null, duration: null })] }));
    expect(m.tracks[0].bpm).toBeNull();
    expect(m.tracks[0].duration).toBeNull();
  });
});

describe("parseManifest — reject", () => {
  test("rejects non-object", () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest(42)).toThrow();
  });

  test("rejects wrong schema", () => {
    expect(() => parseManifest(validManifest({ schema: 2 }))).toThrow(/schema/i);
  });

  test("rejects non-string set/name", () => {
    expect(() => parseManifest(validManifest({ set: 5 }))).toThrow(/set/i);
    expect(() => parseManifest(validManifest({ name: null }))).toThrow(/name/i);
  });

  test("rejects order that is not an array of strings", () => {
    expect(() => parseManifest(validManifest({ order: "t1" }))).toThrow(/order/i);
    expect(() => parseManifest(validManifest({ order: [1, 2] }))).toThrow(/order/i);
  });

  test("rejects missing/non-array tracks", () => {
    expect(() => parseManifest(validManifest({ tracks: undefined }))).toThrow(/tracks/i);
    expect(() => parseManifest(validManifest({ tracks: {} }))).toThrow(/tracks/i);
  });

  test("rejects a track with a non-string / empty id", () => {
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ id: 5 })] }))).toThrow(/id/i);
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ id: "" })] }))).toThrow(/id/i);
  });

  test("rejects a track with non-string title/artist", () => {
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ title: 1 })] }))).toThrow(/title/i);
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ artist: null })] }))).toThrow(/artist/i);
  });

  test("rejects a track with empty audio/peaks", () => {
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ audio: "" })] }))).toThrow(/audio/i);
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ peaks: "" })] }))).toThrow(/peaks/i);
  });

  test("rejects a track with non-positive peaks_rate", () => {
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ peaks_rate: 0 })] }))).toThrow(/peaks_rate/i);
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ peaks_rate: -1 })] }))).toThrow(/peaks_rate/i);
  });

  test("rejects a track with invalid bpm/duration types", () => {
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ bpm: "128" })] }))).toThrow(/bpm/i);
    expect(() => parseManifest(validManifest({ tracks: [validTrack({ duration: "200" })] }))).toThrow(/duration/i);
  });
});
