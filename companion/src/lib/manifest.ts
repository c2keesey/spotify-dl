import type { Manifest, TrackMeta } from "@/lib/types";

function fail(reason: string): never {
  throw new Error(`Invalid manifest: ${reason}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string") fail(`${field} must be a string`);
  return v;
}

function nonEmptyStr(v: unknown, field: string): string {
  const s = str(v, field);
  if (s.length === 0) fail(`${field} must be a non-empty string`);
  return s;
}

function numOrNull(v: unknown, field: string): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || Number.isNaN(v)) fail(`${field} must be a number or null`);
  return v;
}

function parseTrack(v: unknown, i: number): TrackMeta {
  if (!isObject(v)) fail(`tracks[${i}] must be an object`);
  const peaksRate = v.peaks_rate;
  if (typeof peaksRate !== "number" || !(peaksRate > 0)) {
    fail(`tracks[${i}].peaks_rate must be a positive number`);
  }
  return {
    id: nonEmptyStr(v.id, `tracks[${i}].id`),
    title: str(v.title, `tracks[${i}].title`),
    artist: str(v.artist, `tracks[${i}].artist`),
    bpm: numOrNull(v.bpm, `tracks[${i}].bpm`),
    key_name: typeof v.key_name === "string" ? v.key_name : "",
    camelot: typeof v.camelot === "string" ? v.camelot : "",
    genre: typeof v.genre === "string" ? v.genre : "",
    duration: numOrNull(v.duration, `tracks[${i}].duration`),
    audio: nonEmptyStr(v.audio, `tracks[${i}].audio`),
    peaks: nonEmptyStr(v.peaks, `tracks[${i}].peaks`),
    peaks_rate: peaksRate,
  };
}

export function parseManifest(json: unknown): Manifest {
  if (!isObject(json)) fail("root must be an object");
  if (json.schema !== 1) fail("schema must be 1");
  const set = str(json.set, "set");
  const name = str(json.name, "name");
  const created_at = typeof json.created_at === "string" ? json.created_at : "";

  const order = json.order;
  if (!Array.isArray(order) || !order.every((o) => typeof o === "string")) {
    fail("order must be an array of strings");
  }

  const tracks = json.tracks;
  if (!Array.isArray(tracks)) fail("tracks must be an array");

  return {
    schema: 1,
    set,
    name,
    created_at,
    order: order as string[],
    tracks: tracks.map(parseTrack),
  };
}
