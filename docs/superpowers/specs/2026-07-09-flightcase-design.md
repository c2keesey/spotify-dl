# Flightcase — Offline Companion App

**Date:** 2026-07-09
**Status:** Approved, ready for planning

## Goal

Let Helen work on a DJ set on a plane. She listens to tracks, scrubs a waveform,
and places hot cues and loops on an iPad or iPhone with no network. Her work
comes home as rekordbox hot cues.

## The round trip

```
Mac (Crate)                          iPad (Flightcase PWA)
  export bundle   ──── AirDrop ────▶  import → OPFS
  set.crate = audio + peaks + manifest
                                        ↓  airplane mode
                                      place hot cues, loops, reorder
  build XML       ◀─── AirDrop ────   export cues.json
       ↓
  rekordbox XML with POSITION_MARK
       ↓  Helen imports by hand
  rekordbox: a NEW playlist
```

## Global constraints

These are not preferences. They bound every task.

- **`master.db` is never written by this feature.** Bundle export reads the
  library; cue import produces an XML document on disk. The additive-only
  guarantee holds by construction, not by discipline. No task may add a
  `master.db` write path.
- **Audio is copied byte-for-byte.** No transcode, no resample, no
  normalization. A cue timestamp set on the iPad must land on the same sample
  in rekordbox; encoder padding would silently shift it.
- **Crate never moves, deletes, or "repairs" the user's audio files.**
- **No test may read or write the real `master.db`.** The autouse fixtures in
  `tests/conftest.py` stay in force.
- **Cues are the only irreplaceable data.** The bundle is large and
  reconstructible; the cues are small and cannot be recovered. Persist cues on
  every edit.
- **Components come from shadcn/ui**, matching the existing `frontend/` install
  (Radix primitives + `class-variance-authority` + `tailwind-merge`). No second
  component library.
- Hot cue slots are `0..7`, serialized to rekordbox A–H. A loop is a slot with
  an end time.

## Architecture

Three units with one contract between them: the bundle format.

### 1. Bundle format (`.crate`)

A zip. One file AirDrops cleanly; the iOS Files app holds it without ceremony.

```
manifest.json           schema version, set name, track metadata, order
audio/<content_id>.mp3  the original bytes, unmodified
peaks/<content_id>.bin  waveform envelope, 200 samples/sec, one uint8 per sample
```

`manifest.json`:

```json
{
  "schema": 1,
  "set": "helens-set",
  "name": "Helen's Set",
  "created_at": "2026-07-09T18:00:00Z",
  "order": ["4471", "2210"],
  "tracks": [
    {
      "id": "4471",
      "title": "333",
      "artist": "Whyte Fang",
      "bpm": 174.0,
      "key_name": "Fm",
      "camelot": "4A",
      "genre": "Drum & Bass",
      "duration": 214,
      "audio": "audio/4471.mp3",
      "peaks": "peaks/4471.bin",
      "peaks_rate": 200
    }
  ]
}
```

Peaks are precomputed on the Mac because the iPad must not decode hundreds of
megabytes to draw a waveform. At 200 samples/sec a six-minute track costs about
72KB; a forty-track set carries roughly 3MB of waveform.

Tracks whose `file_state` is not `present` are excluded from the bundle and
reported in the response, following the missing-file policy already documented
in `setfile.py`.

### 2. Backend (existing FastAPI app)

**`spotify_dl/bundle.py`** (new)

- `peaks(path, rate=200) -> bytes` — ffmpeg decodes to mono 8-bit PCM, reduced
  to one absolute-peak byte per `1/rate` second. `dj.py` already shells out to
  ffmpeg for loudness; reuse that subprocess discipline (timeout, no lock held
  across the call).
- `build(set_dir, stem, out_dir) -> (path, skipped)` — resolves the set through
  `setfile.resolve_entries`, writes the zip, returns its path and the list of
  tracks skipped for a non-`present` file state.
- `parse_cues(data) -> dict` — validates a `cues.json` payload: schema version,
  slot range `0..7`, `start >= 0`, `end` either null or `> start`. Rejects
  anything else with a clear message rather than silently dropping cues.

**`spotify_dl/setfile.py`** (modify) — `to_rekordbox_xml(tracks, playlist_name,
cues=None)` gains an optional cue map keyed by track id, emitting
`POSITION_MARK` children on each `TRACK` node:

```xml
<POSITION_MARK Name="drop" Type="0" Start="34.512" Num="0"/>
<POSITION_MARK Name="build" Type="4" Start="12.000" End="20.000" Num="1"/>
```

Point cues carry no `End`. Loops carry `End` and `Type="4"`. Absent `cues`, the
function's current output is byte-identical to today's.

**`spotify_dl/web.py`** (modify) — two endpoints:

- `POST /api/dj/bundle` `{set: stem}` → streams the zip; response header carries
  the skipped-track count.
- `POST /api/dj/cues/xml` `{cues: <cues.json>}` → returns the XML text. Resolves
  track ids against the library for metadata, applies `order` for playlist
  sequence, and applies each track's cues. Never opens `master.db` for write.

Bundles are written to `bundles/` at the repo root, gitignored alongside `sets/`.

### 3. Flightcase PWA (`companion/`, new)

A separate Vite app with its own build, deployed as static files to an HTTPS
host (Cloudflare Pages or GitHub Pages). **It cannot be a route on the FastAPI
server:** service workers require a secure context, and `http://192.168.x.x`
is not one, so the app shell would never cache and the app would not open in
airplane mode. HTTPS is needed only at install time; afterward the app is fully
offline. It makes no network request after the shell is cached — Helen's audio
never leaves AirDrop, and the host only ever serves JS and CSS.

It shares the Crate aesthetic (vintage instrument panel: phosphor green and VFD
amber on warm near-black, Chakra Petch display, IBM Plex Sans body, IBM Plex
Mono for all data) and uses shadcn/ui components on Radix primitives, copied
into `companion/src/components/ui/` the same way `frontend/` does it. Reuse
`button`, `card`, `dialog`, `input`, `badge`, `separator`, `scroll-area`. The
waveform and the cue pads are bespoke — they are instruments, not form controls.
Touch targets are at least 44px; the transport and pads must be usable one-handed
on an iPhone and comfortable on an iPad.

**Screens**

*Import* — a file input takes the `.crate`, `fflate` unzips it, audio streams
into OPFS and the manifest and peaks land in IndexedDB. Shows progress; a
several-hundred-megabyte import is not instant.

*Set* — the track list, reorderable with `@dnd-kit/sortable` (already a Crate
dependency). Shows BPM, key, duration, and how many cues each track carries.

*Track* — the real work. A canvas waveform drawn from the peaks buffer, a
transport bar, and eight cue pads labelled A–H.

- Tap the waveform to place a cue at that position. The time is computed from
  tap-x over duration, so it is exact regardless of the audio element's seek
  precision.
- Drag a cue marker to nudge it. Swipe a pad to clear it.
- Long-press a pad to name it, or to convert it to a loop by setting an end.
- Pinch or a zoom control expands the waveform for fine placement.

**Playback** is a plain `<audio>` element over an OPFS blob URL — it streams,
stays cheap on memory, and seeks well enough. Loops wrap on a
`requestAnimationFrame` check of `currentTime`, not on `timeupdate`, which fires
only about four times a second and would overshoot audibly.

**Persistence.** Cues write to IndexedDB on every edit. The Set screen carries
an always-available "Export cues" action that writes `cues.json` via the Web
Share API, falling back to a download. If iOS evicts OPFS under disk pressure,
Helen re-imports the `.crate` still sitting in Files — thirty seconds. Losing
cues would cost the flight, so they are never only in memory.

`cues.json`:

```json
{
  "schema": 1,
  "set": "helens-set",
  "exported_at": "2026-07-09T22:14:00Z",
  "order": ["2210", "4471"],
  "tracks": [
    {"id": "4471", "cues": [
      {"num": 0, "name": "drop", "start": 34.512, "end": null},
      {"num": 1, "name": "build", "start": 12.0, "end": 20.0}
    ]}
  ]
}
```

The iPad's cue model *is* rekordbox's cue model, so there is nothing to
reconcile at import time.

## Open question to resolve before implementation

Does `navigator.storage.persist()` grant on an iOS home-screen web app, or
silently resolve `false`? This changes only how loudly the Import screen warns
about eviction. **Resolve with a ten-minute spike on the actual iPad before
writing the Import screen**; the plan must not guess.

## Error handling

- **Bundle export with no present files** → 400 with the skipped list, not an
  empty zip.
- **Corrupt or wrong-schema `.crate`** → the Import screen rejects it by name
  and reason, and leaves any previously imported set intact.
- **`cues.json` referencing a track id not in the library** → `/api/dj/cues/xml`
  reports the unknown ids and emits XML for the rest, rather than failing whole.
- **Duplicate slot numbers within one track** → `parse_cues` rejects; the PWA's
  data model makes it unrepresentable, so this can only arrive from a
  hand-edited file.
- **OPFS quota exceeded mid-import** → abort cleanly, delete the partial set,
  tell her how much space the bundle needs.

## Testing

**Python.** Build a bundle from a synthetic wav and assert the manifest schema,
the peaks length against `rate × duration`, and that the audio bytes in the zip
are identical to the source. Assert missing-file exclusion. Assert
`POSITION_MARK` serialization for point cues and loops, and that omitting `cues`
leaves today's XML unchanged. Assert `parse_cues` rejects out-of-range slots,
negative starts, and `end <= start`.

**PWA.** Vitest over the pure logic, no browser driver: cue store reducers,
tap-x-to-time math, loop wrap boundaries at track end, manifest parsing and
schema rejection, peaks-to-canvas coordinate mapping.

## Out of scope

Beatgrid display, key/BPM editing, waveform color coding by frequency band,
syncing more than one set at a time, and writing `DjmdCue` rows directly into
`master.db`. That last one is a deliberate deferral — file a bead once the XML
round trip is proven in practice.

## Naming

"Flightcase." Rename freely; the module is `spotify_dl/bundle.py` and the app
directory is `companion/` regardless.
