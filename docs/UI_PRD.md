# spotify-dl Web UI — Product Requirements

A localhost web UI for the spotify-dl CLI. You paste Spotify/SoundCloud links,
pick where to save, and download — with optional repeating schedules. This
document covers the rebuilt UI: same scope, but trustworthy and nice to use.

## Goals

- **Beautiful** — a refined dark, Spotify-green interface I'm happy to show people.
- **Minimal** — single static `index.html`, one FastAPI module, no build step.
- **Trustworthy** — you always know what's happening and why something failed.
- **Tested** — the web layer has real pytest coverage.

## Non-goals

- No accounts, multi-user, or remote hosting (localhost only).
- No settings panel — concurrency (`-mc 4`) and no-overwrite (`-w`) stay fixed.
- No editing of crons created outside this UI (still read-only / toggle-only).

## The problem with today's UI

1. **Failures are opaque.** A failed download shows a red dot and "Failed". The
   real reason (e.g. a Spotify editorial `37i9…` playlist now 404s on the API)
   is buried in a Python traceback you have to expand a log to find.
2. **You download blind.** You paste a link and hope. No confirmation of what
   the link actually is until tracks start (or don't) arriving.
3. **The folder picker is clumsy.** Modal-only, no recents, no typeahead, easy
   to lose your place.
4. **No sense of the library.** No way to see what's already been downloaded.

## Features

### 1. Link preview + validation (new)
As links are pasted/typed, each resolves to a preview card: cover art, name,
kind (track / album / playlist), and track count. Invalid or unfetchable links
show a clear reason inline **before** you hit Download — most importantly the
editorial-playlist case ("Spotify no longer allows API access to its `37i9…`
playlists"). SoundCloud links validate by shape (preview fetch is skipped — too
slow — but they're marked accepted).

### 2. Clear error surfacing (fix)
No raw terminal output. A fully failed job carries a plain-English `error`
derived from its log — known cases get specific messages (editorial playlist,
private/deleted item, missing Spotify credentials, yt-dlp/deno failure), with a
fallback to the last meaningful line. A job that mostly succeeds shows how many
tracks **didn't make it**, expandable to the list of track names (those that
failed to download or couldn't be matched on YouTube). Each download job is
labelled like a preview — cover art + display name + track count — not the URL.

### 3. Library / downloads browser (new)
A panel listing the contents of the current output folder: each subfolder with
its track count, plus a "Reveal in Finder" affordance. Refreshes as downloads
complete so you watch your library fill in.

### 4. Folder picker — native
"Browse" opens the **real macOS "Choose Folder" dialog** (via `osascript`,
since the server runs locally on the user's Mac), starting at the current output
folder and returning a real absolute path. On non-macOS, or if the dialog can't
launch, it falls back to the in-browser picker (quick-place chips + recents,
type-to-filter, keyboard navigation).

### 5. Download + schedule (kept + editable)
Paste links → Download. Scheduling (daily / weekly / hourly cron) as before, now
with **Edit**: clicking Edit on a managed schedule loads its links, output, and
timing back into the form and saves changes in place (preserving the enabled/
disabled state) instead of creating a duplicate. Both flows benefit from preview
+ error surfacing. Crons created outside this UI remain read-only.

## API surface

Existing: `POST /api/download`, `GET /api/jobs`, `GET /api/config`,
`GET /api/browse`, `GET/POST/DELETE /api/crons…`.

Cron editing: `PUT /api/crons/{id}` edits a managed schedule in place
(preserving enabled state); `GET /api/crons` items include parsed `fields`
(`freq/hour/minute/dow/every`) so the UI can prefill the edit form.

New / changed:
- `GET /api/preview?url=…` → `{kind, name, image, count, error}` for one link.
- `GET /api/jobs` items gain `meta` (resolved name/cover per link), an `error`
  field, and `progress.failed` / `progress.failed_tracks` (tracks that didn't
  make it). The per-job raw-log endpoint is removed.
- `GET /api/library?path=…` → `{path, folders:[{name, tracks}], loose}`.
- `POST /api/reveal` `{path}` → opens the folder in Finder.
- `POST /api/pick-folder` `{start}` → opens the native macOS folder dialog,
  returns `{path}` or `{cancelled: true}` (501 on non-macOS).

## Visual direction

Refined Spotify-dark. Near-black background, layered panels, `#1db954` green as
the single accent. SF/system type, monospace for paths and logs. Cover art gives
the preview and library panels life. Smooth, restrained micro-interactions
(progress fills, pulse on active jobs). One column, centered, ~640px.

## Testing

`tests/test_web.py` using FastAPI `TestClient`, covering: download job lifecycle
(mocked subprocess), error summarization for each known failure class, preview
(mocked Spotify client + SoundCloud shape), browse/library against a temp dir,
and cron create/list/toggle/delete (mocked crontab). No network, no real
downloads.
