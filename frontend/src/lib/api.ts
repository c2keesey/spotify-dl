import type { AppConfig, BrowseResult, Cron, DjStatus, DjTrack, DuplicatesResult, EnergyResult, FileState, ImportResult, Job, Library, LinkMeta, OpenSet, Rating, RekordboxPlaylist, SetSummary, SuggestResult } from "./types";

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI puts the human-readable reason in `detail`; fall back to the status text. */
async function detailOf(r: Response): Promise<string> {
  try { return (await r.json()).detail ?? r.statusText; } catch { return r.statusText; }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) throw new ApiError(r.status, await detailOf(r));
  return (await r.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  config: () => req<AppConfig>("/api/config"),
  preview: (url: string) => req<LinkMeta>(`/api/preview?url=${encodeURIComponent(url)}`),
  jobs: () => req<Job[]>("/api/jobs"),
  download: (urls: string[], output: string) => req<{ id: number }>("/api/download", post({ urls, output })),
  retry: (jobId: number) => req<{ id: number }>(`/api/jobs/${jobId}/retry`, { method: "POST" }),
  library: (path: string) => req<Library>(`/api/library?path=${encodeURIComponent(path)}`),
  reveal: (path: string) => req<unknown>("/api/reveal", post({ path })).then(() => undefined),
  browse: (path: string) => req<BrowseResult>(`/api/browse?path=${encodeURIComponent(path)}`),
  pickFolder: (start: string) => req<{ cancelled: boolean; path?: string }>("/api/pick-folder", post({ start })),
  crons: () => req<Cron[]>("/api/crons"),
  cronCreate: (body: object) => req<{ id: string }>("/api/crons", post(body)),
  cronUpdate: (id: string, body: object) => req<{ id: string }>(`/api/crons/${id}`, { ...post(body), method: "PUT" }),
  cronToggle: (id: string) => req<{ enabled: boolean }>(`/api/crons/${id}/toggle`, { method: "POST" }),
  cronDelete: (id: string) => req<unknown>(`/api/crons/${id}`, { method: "DELETE" }).then(() => undefined),
  djStatus: (path: string) => req<DjStatus>(`/api/dj/status?path=${encodeURIComponent(path)}`),
  djTracks: (f: { q?: string; bpm_min?: number; bpm_max?: number; camelot?: string; genre?: string; file_state?: FileState | "" }) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.bpm_min) p.set("bpm_min", String(f.bpm_min));
    if (f.bpm_max) p.set("bpm_max", String(f.bpm_max));
    if (f.camelot) p.set("camelot", f.camelot);
    if (f.genre) p.set("genre", f.genre);
    if (f.file_state) p.set("file_state", f.file_state);
    return req<{ tracks: DjTrack[] }>(`/api/dj/tracks?${p}`);
  },
  djImport: (path: string) => req<ImportResult>("/api/dj/import", post({ path })),
  djCompatibility: (ids: string[]) => req<{ ratings: Rating[] }>("/api/dj/compatibility", post({ ids })),
  djEnergy: (ids: string[]) => req<EnergyResult>("/api/dj/energy", post({ ids })),
  /** Ranked candidates for what could play after the set's last slot. Read-only:
   *  it recommends, never reorders or adds — the user clicks to add a row. */
  djSuggest: (ids: string[]) => req<SuggestResult>("/api/dj/suggest", post({ ids })),
  /** Write the ordered set as a NEW rekordbox playlist. `set` is the on-disk
   *  stem of the saved Crate set, so the server can record which playlist this
   *  export produced (re-export makes another new playlist, never mutates one). */
  djExport: (name: string, ids: string[], set?: string) =>
    req<{ playlist: string; playlist_id: string }>("/api/dj/export", post({ name, ids, set })),
  /** Portable exports. Neither touches master.db, so both work while rekordbox
   *  is running -- which is the whole point of them. */
  djExportM3u8: (name: string, ids: string[]) =>
    req<{ path: string; name: string }>("/api/dj/export/m3u8", post({ name, ids })),
  /** The XML document itself, for the browser to save. rekordbox imports it. */
  djExportXml: async (name: string, ids: string[]) => {
    const res = await fetch("/api/dj/export/xml", post({ name, ids }));
    if (!res.ok) throw new ApiError(res.status, await detailOf(res));
    return res.text();
  },
  /** Flightcase bundle: audio + peaks + manifest as one .crate zip. Read-only
   *  w.r.t. rekordbox; skipped-track count rides a response header. */
  djBundle: async (stem: string) => {
    const res = await fetch("/api/dj/bundle", post({ set: stem }));
    if (!res.ok) throw new ApiError(res.status, await detailOf(res));
    return {
      blob: await res.blob(),
      filename: `${stem}.crate`,
      skipped: Number(res.headers.get("X-Skipped-Tracks") || 0),
    };
  },
  /** cues.json (from the Flightcase app) -> rekordbox XML with hot cues.
   *  Unknown ids come back in a header; the XML still covers the rest. */
  djCuesXml: async (cues: unknown) => {
    const res = await fetch("/api/dj/cues/xml", post({ cues }));
    if (!res.ok) throw new ApiError(res.status, await detailOf(res));
    const unknown = (res.headers.get("X-Unknown-Ids") || "").split(",").filter(Boolean);
    return { xml: await res.text(), unknown };
  },
  djDuplicates: () => req<DuplicatesResult>("/api/dj/duplicates"),
  // ---- saved sets (Crate's own files; safe while rekordbox is open) ----
  djSets: () => req<{ sets: SetSummary[] }>("/api/dj/sets").then((r) => r.sets),
  djOpenSet: (stem: string) => req<OpenSet>(`/api/dj/sets/${encodeURIComponent(stem)}`),
  djSaveSet: (name: string, ids: string[]) => req<{ stem: string }>("/api/dj/sets", post({ name, ids })),
  djRenameSet: (stem: string, name: string) => req<{ stem: string }>(`/api/dj/sets/${encodeURIComponent(stem)}`, { ...post({ name }), method: "PATCH" }),
  djDuplicateSet: (stem: string) => req<{ stem: string }>(`/api/dj/sets/${encodeURIComponent(stem)}/duplicate`, { method: "POST" }),
  djDeleteSet: (stem: string) => req<unknown>(`/api/dj/sets/${encodeURIComponent(stem)}`, { method: "DELETE" }).then(() => undefined),
  djPlaylists: () => req<{ playlists: RekordboxPlaylist[] }>("/api/dj/playlists").then((r) => r.playlists),
  /** URL the <audio> element streams from. The id is a rekordbox content id;
   *  the server resolves it to a file — a path is never sent from the client. */
  djAudioUrl: (id: string) => `/api/dj/audio/${encodeURIComponent(id)}`,
};
