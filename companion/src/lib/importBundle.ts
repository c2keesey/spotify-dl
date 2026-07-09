import { Unzip, UnzipInflate } from "fflate";
import type { Manifest, StoredSet } from "@/lib/types";
import { parseManifest } from "@/lib/manifest";
import { db } from "@/lib/idb";
import { writeAudio, deleteSetAudio } from "@/lib/opfs";

const MANIFEST_ENTRY = "manifest.json";

// ── Pure, testable helpers ────────────────────────────────────────────────

/** Human-readable byte size, e.g. 350_000_000 → "334 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // whole numbers for bytes; one decimal for small values, none for large
  const rounded = i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** Basename of a zip entry path: "audio/t1.mp3" → "t1.mp3". */
export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export type ExpectedEntry =
  | { kind: "audio"; entry: string; name: string; trackId: string; title: string }
  | { kind: "peaks"; entry: string; trackId: string; title: string };

/**
 * Map every zip entry named by the manifest (`tracks[].audio` / `tracks[].peaks`)
 * to what we should do with it, keyed by the entry path as it appears in the zip.
 * Any zip entry not in this map is ignored on import.
 */
export function expectedEntries(manifest: Manifest): Map<string, ExpectedEntry> {
  const m = new Map<string, ExpectedEntry>();
  for (const t of manifest.tracks) {
    m.set(t.audio, {
      kind: "audio",
      entry: t.audio,
      name: baseName(t.audio),
      trackId: t.id,
      title: t.title,
    });
    m.set(t.peaks, { kind: "peaks", entry: t.peaks, trackId: t.id, title: t.title });
  }
  return m;
}

// ── Internal streaming machinery ──────────────────────────────────────────

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === "QuotaExceededError" || e.code === 22;
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "QuotaExceededError";
}

/**
 * Pass 1 — stream the whole file but only decode + buffer `manifest.json`
 * (Crate writes it last, so we must read to the end). Audio/peaks entries are
 * never `start()`ed, so fflate skips their bytes without buffering. Validates
 * with parseManifest before returning. Throws a user-readable Error.
 */
async function readManifest(file: File): Promise<Manifest> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  let failure: unknown = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    if (f.name !== MANIFEST_ENTRY) return; // skip: not started → bytes discarded
    f.ondata = (err, chunk, final) => {
      if (err) {
        failure = err;
        return;
      }
      if (chunk && chunk.length) {
        chunks.push(chunk);
        total += chunk.length;
      }
      if (final) complete = true;
    };
    f.start();
  };

  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) unzip.push(value, !!done);
      else if (done) unzip.push(new Uint8Array(0), true);
      if (failure) throw failure;
      if (complete) break; // manifest fully read — stop early, no need to read on
      if (done) break;
    }
  } catch (e) {
    if (e instanceof Error && /Invalid manifest/i.test(e.message)) throw e;
    throw new Error("This bundle is corrupt or not a Crate .crate file.");
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!complete) {
    throw new Error("This bundle has no manifest.json — it may not be a Crate .crate file.");
  }
  return parseManifest(JSON.parse(new TextDecoder().decode(concat(chunks, total))));
}

/**
 * Pass 2 — stream audio → OPFS and peaks → IndexedDB, one entry at a time.
 * Backpressure: after each read we persist any entries that just completed and
 * await those writes before pulling the next chunk, so at most one in-flight
 * audio buffer (~10-15 MB) is held. Returns which entries + peaks were written
 * (for missing-entry detection and failure cleanup).
 */
async function writeEntries(
  file: File,
  manifest: Manifest,
  writtenPeaks: string[],
  onProgress: (done: number, total: number, label: string) => void,
): Promise<Set<string>> {
  const stem = manifest.set;
  const expected = expectedEntries(manifest);
  const totalCount = expected.size;
  const written = new Set<string>();
  const pending: Array<{ meta: ExpectedEntry; data: Uint8Array }> = [];
  let doneCount = 0;
  let failure: unknown = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    const meta = expected.get(f.name);
    if (!meta) return; // unknown entry → skip
    const chunks: Uint8Array[] = [];
    let total = 0;
    f.ondata = (err, chunk, final) => {
      if (err) {
        failure = err;
        return;
      }
      if (chunk && chunk.length) {
        chunks.push(chunk);
        total += chunk.length;
      }
      if (final) pending.push({ meta, data: concat(chunks, total) });
    };
    f.start();
  };

  const drain = async () => {
    while (pending.length) {
      const { meta, data } = pending.shift()!;
      if (meta.kind === "audio") {
        await writeAudio(stem, meta.name, data);
      } else {
        await db.putPeaks(stem, meta.trackId, data);
        writtenPeaks.push(meta.trackId);
      }
      written.add(meta.entry);
      doneCount++;
      onProgress(doneCount, totalCount, meta.title || baseName(meta.entry));
    }
  };

  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) unzip.push(value, !!done);
      else if (done) unzip.push(new Uint8Array(0), true);
      if (failure) throw failure;
      await drain();
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return written;
}

async function cleanup(stem: string, writtenPeaks: string[], createdCues: boolean): Promise<void> {
  await deleteSetAudio(stem).catch(() => {});
  for (const trackId of writtenPeaks) await db.deletePeaks(stem, trackId).catch(() => {});
  if (createdCues) await db.deleteCues(stem).catch(() => {});
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Import a .crate bundle: validate the manifest, stream audio to OPFS and peaks
 * to IndexedDB, seed an empty cues row only if none exists (re-import never
 * clobbers her cues), then register the set last. On any failure, partial writes
 * are removed before a user-readable Error is thrown.
 */
export async function importBundle(
  file: File,
  onProgress: (done: number, total: number, label: string) => void,
): Promise<StoredSet> {
  const manifest = await readManifest(file); // throws readable Error; nothing written yet
  const stem = manifest.set;
  const expected = expectedEntries(manifest);

  const writtenPeaks: string[] = [];
  let createdCues = false;

  try {
    const written = await writeEntries(file, manifest, writtenPeaks, onProgress);

    const missing = [...expected.keys()].filter((k) => !written.has(k));
    if (missing.length) {
      const sample = missing.slice(0, 3).map(baseName).join(", ");
      throw new Error(
        `Bundle is incomplete: ${missing.length} file(s) named in the manifest are missing (${sample}${missing.length > 3 ? ", …" : ""}).`,
      );
    }

    // Seed cues only when absent — a re-import must keep her existing work.
    const existing = await db.getCues(stem);
    if (Object.keys(existing).length === 0) {
      await db.putCues(stem, {});
      createdCues = true;
    }

    // Set row written last, so a set only ever lists once fully imported.
    const stored: StoredSet = {
      stem,
      name: manifest.name,
      manifest,
      order: manifest.order,
      importedAt: new Date().toISOString(),
    };
    await db.putSet(stored);
    return stored;
  } catch (e) {
    await cleanup(stem, writtenPeaks, createdCues);
    if (isQuotaError(e)) {
      throw new Error(
        `Not enough space: this bundle needs ~${formatBytes(file.size)}; free up storage and re-import.`,
      );
    }
    throw e instanceof Error ? e : new Error(`Import failed: ${String(e)}`);
  }
}
