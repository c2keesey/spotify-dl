# DJ Set Builder — Design

**Date:** 2026-07-07
**Status:** Approved, ready for implementation planning
**Branch:** `dj-set-builder` (on `spotify-dl`)

## Summary

Add a **"DJ / Sets" tab** to the existing spotify-dl web UI that turns a downloaded
music library into DJ-ready sets: show each track's BPM and Camelot key, help order a
set for harmonic mixing, and export the ordered set back into rekordbox.

This is **not a new app**. It is a feature branch on `spotify-dl`, reusing its FastAPI
backend (`spotify_dl/web.py`), its single-page vanilla-JS frontend
(`spotify_dl/static/index.html`), and its existing library/download machinery.

## Motivation

The user's girlfriend DJs from **local audio files in rekordbox** and uses the existing
`spotify-dl` fork to go from Spotify playlists to those local files. She wants to see
BPM / Camelot key, order tracks for her sets, and get them into rekordbox with as little
friction as possible.

Two facts shaped the design:

- **Spotify's audio-features API (BPM/key) is locked for new apps** (since Nov 2024), so
  we do not get BPM/key from Spotify.
- **rekordbox already analyzes BPM, key, and beat grids** on import and stores them in its
  database. Reading that is both easier and more accurate (it is exactly what she DJs
  with) than re-computing analysis ourselves.

So **rekordbox is the analysis engine.** We read, we do not detect.

## Feasibility (validated)

Verified on the user's machine on 2026-07-07:

- rekordbox 7 installed; database at `~/Library/Pioneer/rekordbox/master.db` (SQLCipher-encrypted).
- `pyrekordbox` (`Rekordbox6Database`, which supports rekordbox 6 **and** 7) opened the
  live DB read-only and returned **1,465 tracks — 1,440 with BPM, 1,392 with key**.
- Keys arrive as standard names (`Am`, `Cm`, `Gm`, `Bbm`, `F`, `G`, …) that map
  deterministically to Camelot. BPM is stored as an integer ×100.
- Playlists are readable. Cue points are readable/writable per pyrekordbox docs (used only
  by the stretch scope).

## Architecture

```
Spotify playlist ──(existing download tab)──▶ local files
      local files ──(she drags into rekordbox)──▶ rekordbox analyzes BPM/key
   master.db ──(pyrekordbox, read-only)──▶ DJ tab: browse / build / order set
        set ──(rekordbox.xml export)──▶ she imports into rekordbox
```

Source-of-truth split:

- **rekordbox `master.db`** — BPM, key, beat grids, track file paths (read-only in v1).
- **spotify-dl** — what was downloaded and where (existing `/api/library` + source map).

New code:

- `spotify_dl/rekordbox.py` — thin wrapper over pyrekordbox. Responsibilities:
  read the collection, expose a normalized track record, map key → Camelot, match
  rekordbox tracks to downloaded folders by file path, and write a rekordbox XML playlist.
  Kept separate from `web.py` so the web module does not bloat and the rekordbox logic is
  independently testable.
- New endpoints in the FastAPI app (in `web.py`, delegating to `rekordbox.py`).
- New "DJ / Sets" tab in `index.html` (same vanilla-JS style as the rest of the file).

### Normalized track record

```
{ id, title, artist, bpm, key_name, camelot, file_path, playlists: [...] }
```

### Camelot mapping

Pure function from rekordbox key name to Camelot code. Minor keys → `A` ring, major → `B`
ring. Examples: `Abm`→1A, `B`→1B, `Ebm`/`D#m`→2A, `Bbm`/`A#m`→3A, `Fm`→4A, `Cm`→5A,
`Gm`→6A, `Dm`→7A, `Am`→8A, `Em`→9A, `Bm`→10A, `F#m`/`Gbm`→11A, `Dbm`/`C#m`→12A;
`B`→1B, `F#`/`Gb`→2B, `Db`/`C#`→3B, `Ab`/`G#`→4B, `Eb`/`D#`→5B, `Bb`/`A#`→6B, `F`→7B,
`C`→8B, `G`→9B, `D`→10B, `A`→11B, `E`→12B. Handle both sharp and flat spellings and a
`None`/unknown fallback.

## API

- `GET /api/dj/tracks` — normalized track list, with optional `bpm_min`, `bpm_max`,
  `camelot`, and free-text `q` filters. Reads `master.db` read-only.
- `GET /api/dj/coverage?path=<downloaded_folder>` — for a downloaded playlist folder,
  return how many of its files are present/analyzed in rekordbox (match by file path),
  plus the list of not-yet-analyzed files. Ties the download library to rekordbox.
- `POST /api/dj/suggest-order` — body: list of track ids. Returns the suggested order and,
  for each adjacent pair, a compatibility rating (`good` / `ok` / `clash`).
- `POST /api/dj/export` — body: set name + ordered track ids. Writes a `rekordbox.xml`
  containing one playlist for the set (tracks referenced by file location so rekordbox
  matches them to its existing analyzed collection). Returns the file path. Read-only on
  `master.db`.

## Set ordering (v1)

Greedy nearest-neighbor, explainable and overridable:

1. Start from the user-chosen first track (or the lowest-BPM track if none chosen).
2. Repeatedly append the unused track with the best combined score:
   - **Harmonic:** best if same Camelot code, or ±1 on the same ring, or relative
     major/minor (same number, other ring); worse otherwise.
   - **Tempo:** prefer small BPM deltas; tolerate half-time / double-time matches.
3. Manual drag-reorder always available; the suggestion is a starting point, not a lock.

Adjacent-pair compatibility hint (green/yellow/red) uses the same harmonic + tempo rules
so the user sees why an order is good.

## Export (v1): rekordbox XML

- Read the set's tracks (with file locations) from `master.db`.
- Emit a rekordbox `.xml` with a `COLLECTION` of the set's tracks and a `PLAYLISTS` node
  containing one playlist in the chosen order. Tracks carry their known BPM/key/location so
  rekordbox reconciles them against the existing collection by path.
- One-time user setup: enable the rekordbox XML bridge (Preferences → Advanced → Database →
  rekordbox xml), point it at the exported file, import the playlist.
- **Safety:** v1 never writes to `master.db`. Even so, the rekordbox module refuses any
  future write while rekordbox is running and snapshots `master.db` before writing.

## Frontend: "DJ / Sets" tab

Same vanilla-JS conventions as the existing `index.html` (no framework).

- **Track browser:** searchable/filterable table by BPM range and Camelot key; each row
  shows title, artist, BPM, Camelot.
- **Coverage strip:** per downloaded playlist folder, "X of Y analyzed in rekordbox," with
  a way to see which files still need importing.
- **Set builder:** add tracks to a set; "Suggest order" button; drag to reorder;
  green/yellow/red compatibility marker between neighbors; a set-wide BPM/key overview
  (min–max BPM, key spread).
- **Export:** name the set, click Export → writes `rekordbox.xml`, shows the path and the
  one-time import instructions.

## Out of scope (explicitly deferred)

Stretch / v2, not built in this pass:

- **Direct DB write** of the playlist into `master.db` (the "set just appears in
  rekordbox" upgrade). Bounded follow-up once XML export is proven; requires rekordbox
  closed + master.db backup.
- **Visual Camelot wheel.**
- **Set energy curve.**
- **Auto hot cues.** Honest auto-cueing (drop / phrase detection) is genuinely hard;
  deferred rather than shipped half-working.

## Testing

- **Camelot mapping:** pure-function unit tests over all 24 keys, both sharp/flat
  spellings, and the unknown/None fallback.
- **Ordering:** unit tests on `suggest-order` with small fixed track sets — assert
  harmonic adjacency and BPM smoothing behavior, and that a fully-compatible set returns
  all-green neighbor ratings.
- **rekordbox read:** a fixture/guarded test that reads the collection if a rekordbox DB is
  present, skipped otherwise (matches the existing repo pattern of environment-dependent
  tests in `tests/test_web.py`).
- **XML export:** assert the emitted XML parses, contains one playlist with the tracks in
  the requested order, and references correct file locations.
- **Endpoints:** extend `tests/test_web.py` for the new `/api/dj/*` routes with the
  rekordbox layer stubbed.
