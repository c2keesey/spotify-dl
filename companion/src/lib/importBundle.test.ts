import { vi, beforeEach } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { formatBytes, baseName, expectedEntries, importBundle } from "@/lib/importBundle";
import type { Manifest, TrackMeta } from "@/lib/types";

// In-memory OPFS: stem -> (audio filename -> bytes).
vi.mock("@/lib/opfs", () => {
  const store = new Map<string, Map<string, Uint8Array>>();
  const dirOf = (stem: string) => {
    let d = store.get(stem);
    if (!d) store.set(stem, (d = new Map()));
    return d;
  };
  return {
    __store: store,
    writeAudio: vi.fn(async (stem: string, name: string, data: Uint8Array) => {
      dirOf(stem).set(name, data);
    }),
    deleteAudioFile: vi.fn(async (stem: string, name: string) => {
      dirOf(stem).delete(name);
    }),
    deleteSetAudio: vi.fn(async (stem: string) => {
      store.delete(stem);
    }),
  };
});

// In-memory IndexedDB stand-in.
vi.mock("@/lib/idb", () => {
  const sets = new Map<string, unknown>();
  const cues = new Map<string, unknown>();
  const peaks = new Map<string, Uint8Array>();
  return {
    __sets: sets,
    __cues: cues,
    __peaks: peaks,
    db: {
      putSet: vi.fn(async (s: { stem: string }) => void sets.set(s.stem, s)),
      getSet: vi.fn(async (stem: string) => sets.get(stem)),
      putCues: vi.fn(async (stem: string, c: unknown) => void cues.set(stem, c)),
      getCues: vi.fn(async (stem: string) => cues.get(stem) ?? {}),
      deleteCues: vi.fn(async (stem: string) => void cues.delete(stem)),
      putPeaks: vi.fn(async (stem: string, tid: string, p: Uint8Array) => void peaks.set(`${stem}/${tid}`, p)),
      deletePeaks: vi.fn(async (stem: string, tid: string) => void peaks.delete(`${stem}/${tid}`)),
    },
  };
});

import * as opfs from "@/lib/opfs";
import * as idb from "@/lib/idb";

type Store = Map<string, Map<string, Uint8Array>>;
const opfsStore = () => (opfs as unknown as { __store: Store }).__store;
const idbStores = () =>
  idb as unknown as { __sets: Map<string, unknown>; __cues: Map<string, unknown>; __peaks: Map<string, Uint8Array> };

/** Build a .crate zip; `manifestFirst` controls whether manifest.json leads.
 * `omitAudio` drops the named audio entries to simulate an incomplete bundle. */
function crate(m: Manifest, opts: { manifestFirst?: boolean; omitAudio?: string[] } = {}): Uint8Array {
  const omit = new Set(opts.omitAudio ?? []);
  const entries: Record<string, Uint8Array> = {};
  const manifestBytes = strToU8(JSON.stringify(m));
  if (opts.manifestFirst) entries["manifest.json"] = manifestBytes;
  for (const t of m.tracks) {
    if (!omit.has(t.audio)) entries[t.audio] = strToU8(`audio-${t.id}`);
    entries[t.peaks] = new Uint8Array([1, 2, 3, 4]);
  }
  if (!opts.manifestFirst) entries["manifest.json"] = manifestBytes;
  // level 0 keeps audio STORED (as Crate emits it); exercises fflate's stored path.
  return zipSync(entries, { level: 0 });
}

function fakeFile(bytes: Uint8Array): File {
  return {
    size: bytes.byteLength,
    stream() {
      const CHUNK = 64 * 1024;
      let i = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i >= bytes.length) return controller.close();
          controller.enqueue(bytes.subarray(i, i + CHUNK));
          i += CHUNK;
        },
      });
    },
  } as unknown as File;
}

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

describe("importBundle", () => {
  beforeEach(() => {
    opfsStore().clear();
    const s = idbStores();
    s.__sets.clear();
    s.__cues.clear();
    s.__peaks.clear();
    vi.clearAllMocks();
  });

  const twoTrackManifest = () =>
    manifest([track(), track({ id: "t2", title: "Song Two", audio: "audio/t2.mp3", peaks: "peaks/t2.bin" })]);

  test.each([
    ["manifest-first", true],
    ["manifest-last", false],
  ])("imports a %s bundle: audio, peaks, and set row all land", async (_label, manifestFirst) => {
    const m = twoTrackManifest();
    const stored = await importBundle(fakeFile(crate(m, { manifestFirst })), () => {});

    expect(stored.stem).toBe("my-set");
    const audio = opfsStore().get("my-set")!;
    expect([...audio.keys()].sort()).toEqual(["t1.mp3", "t2.mp3"]);
    const { __peaks, __sets } = idbStores();
    expect(__peaks.has("my-set/t1")).toBe(true);
    expect(__peaks.has("my-set/t2")).toBe(true);
    expect(__sets.get("my-set")).toBe(stored);
  });

  test("emits at least one progress callback while scanning pass 1", async () => {
    const onProgress = vi.fn();
    await importBundle(fakeFile(crate(twoTrackManifest(), { manifestFirst: true })), onProgress);
    expect(onProgress).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), "Reading manifest…");
  });

  test("a failed re-import spares a prior good import's untouched files", async () => {
    // Seed a prior good import for the same stem: audio, peaks, cues, set row.
    opfsStore().set("my-set", new Map([["prior.mp3", new Uint8Array([9, 9, 9])]]));
    const { __peaks, __cues, __sets } = idbStores();
    __peaks.set("my-set/prior", new Uint8Array([7]));
    __cues.set("my-set", { prior: [{ num: 0, name: "", start: 1, end: null }] });
    const priorSet = { stem: "my-set", name: "Prior" };
    __sets.set("my-set", priorSet);

    // Re-import whose bundle omits audio/t2.mp3 → incomplete → throws → cleanup.
    const m = twoTrackManifest();
    await expect(
      importBundle(fakeFile(crate(m, { manifestFirst: true, omitAudio: ["audio/t2.mp3"] })), () => {}),
    ).rejects.toThrow(/incomplete/i);

    // The prior import survives; deleteSetAudio (whole-dir nuke) never ran.
    expect(opfs.deleteSetAudio).not.toHaveBeenCalled();
    const audio = opfsStore().get("my-set")!;
    expect(audio.has("prior.mp3")).toBe(true); // untouched prior audio survives
    expect(audio.has("t1.mp3")).toBe(false); // this run's audio rolled back
    expect(__peaks.has("my-set/prior")).toBe(true); // prior peaks survive
    expect(__peaks.has("my-set/t1")).toBe(false); // this run's peaks rolled back
    expect(__cues.has("my-set")).toBe(true); // existing cues never touched
    expect(__sets.get("my-set")).toBe(priorSet); // set row still points at the prior import
  });
});
