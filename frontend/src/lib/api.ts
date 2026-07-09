import type { AppConfig, BrowseResult, Cron, DjStatus, DjTrack, DuplicatesResult, EnergyResult, FileState, ImportResult, Job, Library, LinkMeta, OpenSet, Rating, RekordboxPlaylist, SetSummary } from "./types";

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail ?? detail; } catch { /* keep statusText */ }
    throw new ApiError(r.status, detail);
  }
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
  djExport: (name: string, ids: string[]) => req<{ playlist: string }>("/api/dj/export", post({ name, ids })),
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
