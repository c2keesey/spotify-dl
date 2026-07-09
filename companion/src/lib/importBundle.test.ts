import { formatBytes, baseName, expectedEntries } from "@/lib/importBundle";
import type { Manifest, TrackMeta } from "@/lib/types";

describe("formatBytes", () => {
  test("bytes render as whole numbers", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("scales through KB/MB/GB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(350_000_000)).toBe("334 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  test("drops the decimal for values >= 100 in a unit", () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
  });

  test("guards against invalid input", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("baseName", () => {
  test("strips a leading directory", () => {
    expect(baseName("audio/t1.mp3")).toBe("t1.mp3");
    expect(baseName("peaks/t1.bin")).toBe("t1.bin");
  });
  test("returns the input when there is no slash", () => {
    expect(baseName("manifest.json")).toBe("manifest.json");
  });
});

function track(over: Partial<TrackMeta> = {}): TrackMeta {
  return {
    id: "t1",
    title: "Song One",
    artist: "Artist",
    bpm: 128,
    key_name: "A min",
    camelot: "8A",
    genre: "House",
    duration: 200,
    audio: "audio/t1.mp3",
    peaks: "peaks/t1.bin",
    peaks_rate: 200,
    ...over,
  };
}

function manifest(tracks: TrackMeta[]): Manifest {
  return {
    schema: 1,
    set: "my-set",
    name: "My Set",
    created_at: "2026-07-09T00:00:00.000Z",
    order: tracks.map((t) => t.id),
    tracks,
  };
}

describe("expectedEntries", () => {
  test("maps every audio and peaks entry keyed by zip path", () => {
    const m = expectedEntries(
      manifest([track(), track({ id: "t2", title: "Song Two", audio: "audio/t2.mp3", peaks: "peaks/t2.bin" })]),
    );
    expect(m.size).toBe(4);

    const audio = m.get("audio/t1.mp3");
    expect(audio).toEqual({ kind: "audio", entry: "audio/t1.mp3", name: "t1.mp3", trackId: "t1", title: "Song One" });

    const peaks = m.get("peaks/t2.bin");
    expect(peaks).toEqual({ kind: "peaks", entry: "peaks/t2.bin", trackId: "t2", title: "Song Two" });
  });

  test("size equals audio + peaks count (progress total)", () => {
    const m = expectedEntries(
      manifest([track(), track({ id: "t2", audio: "audio/t2.mp3", peaks: "peaks/t2.bin" })]),
    );
    expect(m.size).toBe(4); // 2 tracks × (audio + peaks)
  });
});
