export type Progress = { total: number; done: number; failed: number; current: string; pct: number; failed_tracks: string[]; unmatched: string[] };
export type LinkMeta = { url: string; kind: string | null; name: string | null; image: string | null; count: number | null; error: string | null };
export type Job = { id: number; urls: string[]; output: string; status: "running" | "done" | "failed"; meta: LinkMeta[]; progress: Progress; error: string | null };
export type LibraryFolder = { name: string; path: string; tracks: number; url: string | null };
export type Library = { path: string; folders: LibraryFolder[]; loose: number };
export type CronFields = { freq: "daily" | "weekly" | "hourly"; hour?: number; minute?: number; dow?: number; every?: number };
export type Cron = { id: string; schedule: string; friendly: string; enabled: boolean; managed: boolean; command: string; output?: string; label?: string; urls?: string[]; fields?: CronFields | null };
export type AppConfig = { default_output: string; places: { label: string; path: string }[] };
export type BrowseResult = { path: string; parent: string | null; dirs: string[] };
/** Whether the track's audio file is actually on disk. "unmounted" means the
 *  volume is disconnected, which is emphatically not the same as deleted. */
export type FileState = "present" | "missing" | "unmounted" | "not_a_file";
export type DjTrack = { id: string; title: string; artist: string; bpm: number | null; key_name: string | null; camelot: string | null; genre: string | null; file_path: string; file_state: FileState; duration: number | null; status: "analyzed" | "pending"; playlists: string[] };
export type DjStatus = { running: boolean; can_write: boolean; analyzed: number; pending: number; not_imported: number; missing: number; unmounted: number; not_a_file: number };
export type Rating = "good" | "ok" | "clash";
/** Why a track has no energy value. Only "measured" carries a number. */
export type EnergyState = "measured" | "missing" | "failed";
export type EnergyResult = { energy: Record<string, number | null>; state: Record<string, EnergyState> };
export type ImportResult = { imported: string[]; skipped_duplicates: { path: string; reason: string }[] };
/** Why a duplicate group was matched. "exact_path" is certain (same file at the
 *  same path); "fuzzy" is a guess (same song, different paths). */
export type DupeReason = "exact_path" | "fuzzy";
/** The field values that were compared to form a group, so the UI can show WHY.
 *  exact groups carry file_path; fuzzy groups carry artist/title/duration. */
export type DupeCompared = { file_path?: string; artist?: string; title?: string; norm_title?: string; duration?: number | null };
export type DupeGroup = { reason: DupeReason; compared: DupeCompared; tracks: DjTrack[] };
export type DuplicatesResult = { groups: DupeGroup[]; exact_count: number; fuzzy_count: number };
/** A saved Crate set on disk. `stem` is the stable on-disk id every set endpoint
 *  addresses; `exported` is true once an export mapped it to a rekordbox playlist. */
export type SetSummary = { name: string; stem: string; path: string; created_at: string | null; track_count: number; rekordbox_playlist_id: string | null; rekordbox_playlist_name: string | null; exported: boolean };
/** A stored entry the live collection couldn't fully match. `resolved_id` is the
 *  new id when the entry matched only by path (the content id changed). */
export type ResolvedEntry = { id: string | null; path: string; resolved_id?: string };
/** The result of opening a saved set: resolved tracks in order, plus the entries
 *  that resolved by path only or not at all (surfaced, never silently dropped). */
export type OpenSet = { name: string; stem: string; tracks: DjTrack[]; path_resolved: ResolvedEntry[]; unresolved: ResolvedEntry[]; rekordbox_playlist_id: string | null; rekordbox_playlist_name: string | null };
/** An existing rekordbox playlist read in as a read-only set the user can fork. */
export type RekordboxPlaylist = { id: string; name: string; track_count: number; track_ids: string[] };
/** One ranked candidate for what could play after the set's last slot. Carries
 *  its reasoning — `relation` is the harmonic key relation (e.g. "Same key",
 *  "Energy boost (+1)"), `bpm_delta` the signed tempo change — so the ranking is
 *  never an opaque number. The user clicks to add; nothing is auto-ordered. */
export type Suggestion = { track: DjTrack; rating: Rating; relation: string; bpm_delta: number | null };
export type SuggestResult = { suggestions: Suggestion[] };
