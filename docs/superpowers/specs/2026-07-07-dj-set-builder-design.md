# DJ Set Builder — Design

**Date:** 2026-07-07
**Status:** Approved, ready for implementation planning
**Branch:** `dj-set-builder` (on `spotify-dl`)

## Summary

Add a **"DJ / Sets" tab** to the existing spotify-dl web UI that turns a downloaded
music library into DJ-ready sets: automatically get each track analyzed by rekordbox
(BPM + Camelot key), help order a set for harmonic mixing, and write the ordered set back
into rekordbox as a playlist.

This is **not a new app**. It is a feature branch on `spotify-dl`, reusing its FastAPI
backend (`spotify_dl/web.py`), its single-page vanilla-JS frontend
(`spotify_dl/static/index.html`), and its existing library/download machinery.

## Motivation

The user's girlfriend DJs from **local audio files in rekordbox** and uses the existing
`spotify-dl` fork to go from Spotify playlists to those local files. She wants to see
BPM / Camelot key, order tracks for her sets, and get them into rekordbox with as little
friction as possible — **including no manual "drag folder into rekordbox to analyze" step.**

Two facts shaped the design:

- **Spotify's audio-features API (BPM/key) is locked for new apps** (since Nov 2024), so
  we do not get BPM/key from Spotify.
- **rekordbox already analyzes BPM, key, and beat grids** and stores them in its database.
  Its analysis is exactly what she DJs with, so we use rekordbox's numbers rather than
  computing our own.

So **rekordbox is the analysis engine.** We do not detect BPM/key ourselves. The feature's
job is to *automatically feed tracks into rekordbox for analysis* and read the results back.

## Hard constraint: rekordbox's analyzer only runs inside rekordbox

rekordbox's BPM/key/beat-grid analysis is proprietary DSP that runs **only inside the
rekordbox app**. There is no CLI or library that reproduces it. Therefore "automatic
analysis" means:

1. The tool **auto-imports** downloaded tracks into rekordbox's collection (a DB write).
2. rekordbox, with its **Auto-Analysis** preference on, analyzes those tracks the next time
   it is open.
3. The DJ tab reads the results as they appear.

The single thing that cannot be automated away is that **rekordbox must be open once** for
its engine to actually churn through the new tracks. The tool removes every other manual
step.

### Operational rhythm (single-writer DB)

rekordbox holds an exclusive lock on `master.db`. This dictates a simple rule the tool
enforces and guides the user through:

- **Writes** (auto-import, saving a set as a playlist) require rekordbox to be **closed**.
  The tool detects if rekordbox is running and, if so, queues the write and tells the user
  to close rekordbox.
- **Analysis** requires rekordbox to be **open** (its engine runs there).
- **Reads** (browsing tracks, checking analysis status) work either way.

So the natural loop is: download → (rekordbox closed) auto-import → open rekordbox, it
analyzes → browse/build set in the DJ tab → (rekordbox closed) save set as playlist. The
UI makes the current required state obvious rather than leaving the user to guess.

**This open/closed rhythm is an accepted constraint**, not something to engineer around —
requiring rekordbox open for analysis and closed for writes is fine. The tool just makes
the current required state clear.

## Feasibility (validated 2026-07-07 on the user's machine)

- rekordbox 7 installed; database at `~/Library/Pioneer/rekordbox/master.db` (SQLCipher-encrypted).
- `pyrekordbox` 0.4.4 (`Rekordbox6Database`, supports rekordbox 6 **and** 7) opened the live
  DB read-only and returned **1,465 tracks — 1,440 with BPM, 1,392 with key**.
- Keys arrive as standard names (`Am`, `Cm`, `Gm`, `Bbm`, `F`, `G`, …) that map
  deterministically to Camelot. BPM is stored as an integer ×100.
- Write API confirmed present: `add_content(path)`, `create_playlist(name, …)`,
  `add_to_playlist(playlist, content, track_no)`, plus playlist read helpers. These are the
  primitives for auto-import and set export.

## Architecture

```
Spotify playlist ─(existing download tab)─▶ local files
      local files ─(auto-import: add_content, rekordbox CLOSED)─▶ rekordbox collection
 rekordbox (OPEN, Auto-Analysis) ─▶ computes BPM/key/beatgrid into master.db
        master.db ─(pyrekordbox, read)─▶ DJ tab: browse / build / order set
             set ─(create_playlist + add_to_playlist, rekordbox CLOSED)─▶ rekordbox playlist
```

Source-of-truth split:

- **rekordbox `master.db`** — BPM, key, beat grids, track file paths. Read for browsing;
  **written** for auto-import and set export (both guarded — see Safety).
- **spotify-dl** — what was downloaded and where (existing `/api/library` + source map),
  and the record of which downloaded tracks have already been pushed to rekordbox.

New code:

- `spotify_dl/rekordbox.py` — thin wrapper over pyrekordbox. Responsibilities: read the
  collection, expose a normalized track record, map key → Camelot, auto-import a folder's
  tracks into the collection, detect whether rekordbox is running, back up `master.db`
  before any write, and write a set as a playlist. Kept separate from `web.py` so the web
  module stays lean and the rekordbox logic is independently testable.
- New `/api/dj/*` endpoints in the FastAPI app (in `web.py`, delegating to `rekordbox.py`).
- New "DJ / Sets" tab in `index.html` (same vanilla-JS style as the rest of the file).

### Normalized track record

```
{ id, title, artist, bpm, key_name, camelot, file_path,
  energy,                            # integrated loudness via ffmpeg (already a dep), cached
  status: "analyzed" | "pending",   # pending = imported but rekordbox hasn't analyzed yet
  playlists: [...] }
```

### Camelot mapping

Pure function from rekordbox key name to Camelot code. Minor keys → `A` ring, major → `B`
ring. Examples: `Abm`→1A, `Ebm`/`D#m`→2A, `Bbm`/`A#m`→3A, `Fm`→4A, `Cm`→5A, `Gm`→6A,
`Dm`→7A, `Am`→8A, `Em`→9A, `Bm`→10A, `F#m`/`Gbm`→11A, `Dbm`/`C#m`→12A; `B`→1B, `F#`/`Gb`→2B,
`Db`/`C#`→3B, `Ab`/`G#`→4B, `Eb`/`D#`→5B, `Bb`/`A#`→6B, `F`→7B, `C`→8B, `G`→9B, `D`→10B,
`A`→11B, `E`→12B. Handle both sharp and flat spellings and a `None`/unknown fallback.

## Automatic import & analysis

- **Trigger:** when a download job completes, the tool automatically imports the new
  tracks into rekordbox's collection. If rekordbox is closed, it imports immediately; if
  rekordbox is open, it marks them queued and surfaces a "close rekordbox to import N new
  tracks" prompt. (A manual "import now" control also exists for re-runs.)
- **Dedup check first, always (the key pain point):** before adding *any* track, the tool
  checks whether that song is already in the rekordbox collection and **skips it if so** —
  this is the whole point, because dragging into rekordbox is exactly what creates her
  duplicate copies today. Duplicate detection uses two keys:
  1. **Exact file path** already present in the collection → skip.
  2. **Same song, different file** — normalized `(artist, title)` match (case/whitespace-
     insensitive, feat./remaster noise stripped), optionally corroborated by similar
     duration → skip.
  Skipped-as-duplicate tracks are reported back to the UI ("3 already in rekordbox,
  skipped") so nothing is silently dropped and she can see what matched.
- **Idempotent:** the tool also records which files it has already pushed (by file path,
  cross-referenced with the collection) so re-triggering never double-adds even before the
  fuzzy check runs.
- **Status:** freshly imported tracks are `pending` until rekordbox analyzes them; the DJ
  tab polls and flips them to `analyzed` with real BPM/Camelot when the values appear.
- **User setup (one time):** enable rekordbox's Auto-Analysis preference so newly added
  tracks analyze without manual action. The tool documents this in the tab.

## Energy

rekordbox does not expose a native energy score, so energy is derived — cheaply and
honestly — from `ffmpeg` (already a spotify-dl dependency): integrated loudness
(EBU R128 / `ebur128`) per track, computed once and cached alongside the analysis status.
This drives the set energy curve. BPM is always available as a secondary arc.

## API

- `GET /api/dj/tracks` — normalized track list with `status`, and optional `bpm_min`,
  `bpm_max`, `camelot`, and free-text `q` filters. Read-only.
- `GET /api/dj/status` — is rekordbox running; counts of analyzed vs pending tracks;
  whether a write is currently possible. Drives the UI's "what state do I need" hints.
- `POST /api/dj/import` — body: a downloaded folder path (or list of files). **Runs the
  dedup check first**, then imports only the genuinely new tracks (`add_content`). Returns
  `{imported: [...], skipped_duplicates: [...]}`. Refuses if rekordbox is running; backs up
  `master.db` first. Normally called automatically on download completion; exposed for
  manual re-trigger.
- `POST /api/dj/compatibility` — body: list of track ids in their current order. Returns,
  for each adjacent pair, a compatibility rating (`good` / `ok` / `clash`) using the harmonic
  + tempo rules. Read-only. This is a passive hint on the *user's own* order — it does not
  reorder anything (auto-ordering is deferred; see Out of scope).
- `POST /api/dj/export` — body: set name + ordered track ids. **Always creates a new
  playlist** (`create_playlist`) — if the name exists, it auto-uniquifies (e.g. appends a
  number/timestamp) rather than touching the existing one — then `add_to_playlist` in order.
  Never modifies or overwrites an existing playlist or track. Refuses if rekordbox is
  running; backs up `master.db` first.

## Set ordering (v1): manual, with passive compatibility hints

v1 ordering is **manual**. The DJ arranges the set herself by dragging tracks; the tool does
not auto-reorder or suggest a full order (automatic ordering is deferred — see Out of scope).

What v1 *does* provide is a passive, non-destructive **adjacent-pair compatibility hint**
(green/yellow/red) between each neighboring pair, so she can see at a glance whether her own
order mixes well:

- **Harmonic:** `good` if same Camelot code, ±1 on the same ring, or relative major/minor
  (same number, other ring); `ok` for near-misses; `clash` otherwise.
- **Tempo:** small BPM deltas rate better; half-time / double-time counts as compatible.

The hint only annotates the order she chose — it never rearranges tracks. Only `analyzed`
tracks get a rating; `pending` tracks are listed but greyed until rekordbox finishes them.

## Export (v1): write a rekordbox playlist

Because v1 already writes to `master.db` for auto-import (with backup + closed-rekordbox
guard), the set export uses the same path: a **new** `create_playlist(name)` then
`add_to_playlist` for each track in order. The set appears directly in rekordbox — no XML
bridge, no manual import. A rekordbox-XML export could be added later as an optional
fallback but is not part of v1.

## Safety (core to v1, since v1 writes to the DB)

- **Only ever additive; never overwrite.** Imports only *add* new tracks; exports only
  *create new* playlists. The tool never modifies or deletes an existing collection track
  or playlist. If a set name already exists, it uniquifies the new one rather than touching
  the old.
- **Dedup before every import** (see Automatic import & analysis) so the collection never
  gains a second copy of a song it already has — directly addressing the duplicate-copies
  pain.
- **Every write** (import and export) first copies `master.db` to a timestamped backup
  alongside rekordbox's own `master.backup*.db` files.
- **Never write while rekordbox is running.** The tool checks for the running process and
  refuses, returning a clear "close rekordbox first" state to the UI.
- Writes go through pyrekordbox's supported APIs only; no raw schema surgery.

## Frontend: "DJ / Sets" tab

Same vanilla-JS conventions as the existing `index.html` (no framework).

- **Status banner:** shows whether rekordbox is open/closed and how many tracks are pending
  analysis, so the required next step (open rekordbox to analyze / close it to save) is
  always obvious.
- **Track browser:** searchable/filterable table by BPM range and Camelot key; each row
  shows title, artist, BPM, Camelot, and analyzed/pending status.
- **Set builder:** add tracks to a set; drag to reorder (manual ordering); a
  green/yellow/red compatibility marker between neighbors that updates as she reorders; a
  set-wide BPM/key overview (min–max BPM, key spread).
- **Camelot wheel:** a visual Camelot wheel showing the set's tracks placed on the wheel and
  the move between consecutive tracks, so harmonic jumps are visible at a glance. Clicking a
  wheel segment filters/adds compatible tracks.
- **Energy curve:** a line/area chart of the set's energy (ffmpeg loudness) across position,
  with BPM as a secondary arc — so she can see the set's build and spot energy dips.
- **Save set:** name the set, click Save → writes it into rekordbox as a **new** playlist
  (guarded), confirms success.

## Out of scope (explicitly deferred)

Stretch / v2, not built in this pass:

- **Automatic set ordering.** No greedy/suggested full-set ordering in v1. v1 gives her the
  data (BPM, Camelot, energy), a Camelot wheel, and passive adjacent-pair compatibility hints,
  but she arranges the set herself. An "auto-order this set" button (harmonic + tempo
  nearest-neighbor, overridable) is a natural v2 addition once the manual flow feels right.
- **Auto hot cues.** Honest auto-cueing (drop / phrase detection) is genuinely hard;
  deferred rather than shipped half-working.
- **Driving rekordbox to analyze headlessly.** Not possible (proprietary in-app DSP);
  the tool relies on rekordbox's own Auto-Analysis while open.

## Direction for a future version (not v1)

A note on where this could grow, captured so the v1 design doesn't accidentally foreclose it:
the longer-term ambition is for this to become **a genuinely better general-purpose interface
for building DJ sets** — not just a viewer bolted onto rekordbox, but the primary place she
assembles sets, which then flow into rekordbox. Two directions worth keeping in mind:

- **Round-trip / replace, not just append.** v1 is strictly additive (new playlists only) for
  safety. A future version could offer *managed* sets it's allowed to update in place — edit a
  set here and have the corresponding rekordbox playlist re-sync — once the safety model
  (backups, dedup, clear ownership of "tool-managed" playlists) is proven.
- **File-based manipulation as an alternative backend.** Because the sets are ultimately just
  ordered lists of local files, a future version could operate directly on files/rekordbox-XML
  (reorder, replace, restructure) rather than going only through the live `master.db`. That
  would loosen the open/closed rhythm and make the tool the source of truth for set-building,
  with rekordbox as one export target among possibly others.

These are explicitly **not** part of v1 and don't need to be designed now — v1 keeps the
additive, `master.db`-only, manual-ordering scope above. This note just records the intended
trajectory so v1's boundaries are understood as a starting point, not the ceiling.

## Testing

- **Camelot mapping:** pure-function unit tests over all 24 keys, both sharp/flat spellings,
  and the unknown/None fallback.
- **Compatibility hints:** unit tests on `compatibility` with small fixed track sets — assert
  that adjacent-pair ratings follow the harmonic + tempo rules (e.g. same Camelot / ±1 / relative
  major-minor rate `good`, a distant key + big BPM jump rates `clash`), and that a fully-
  compatible order returns all-green. No auto-ordering is tested (it's out of scope).
- **rekordbox read:** a fixture/guarded test that reads the collection if a rekordbox DB is
  present, skipped otherwise (matches the existing environment-dependent tests in
  `tests/test_web.py`).
- **Dedup:** unit tests that import skips a track already present by exact path and by
  normalized `(artist, title)`, that near-but-different titles are *not* wrongly merged, and
  that skipped duplicates are reported rather than silently dropped.
- **New-playlist-always:** unit test that export creates a new playlist and uniquifies the
  name when it collides, never modifying the existing one.
- **Write guards:** unit tests that `import` and `export` refuse when rekordbox is detected
  as running and that a backup is created before any write (rekordbox layer stubbed).
- **Energy:** unit test that loudness is parsed from ffmpeg output and cached (ffmpeg stubbed).
- **Endpoints:** extend `tests/test_web.py` for the new `/api/dj/*` routes with the
  rekordbox layer stubbed.
