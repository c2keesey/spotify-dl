# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spotify-dl downloads songs from Spotify playlists, albums, or tracks by fetching metadata from the Spotify API and downloading audio from YouTube using yt-dlp. Personal fork of SathyaBhat/spotify-dl (upstream is dormant since July 2024; this fork is ahead of it) with added playlist-sync mode for offline DJ libraries.

Issue tracking uses beads (`bd`) — see AGENTS.md for the session workflow.

## Critical Runtime Requirements

- **deno must be installed** (`brew install deno`). yt-dlp requires a JS runtime to solve YouTube's signature challenges, and deno is the only runtime it enables by default. Without it, every download fails ("Signature solving failed", 403s, or empty output folders).
- **Do NOT use browser cookies** (`-b`/`--cookies-from-browser` or `cookies_from_browser` in sync config). Logged-in YouTube sessions require PO tokens yt-dlp can't generate, so cookies cause HTTP 403 on every download. The flag exists but should stay unused unless YouTube's behavior changes.
- **Don't loosen the dependency pins.** `urllib3>=2.0.2` and `yt-dlp[default]>=2025.11` in pyproject.toml are load-bearing: an old `urllib3~=1.26` pin once silently held yt-dlp at a 2024 version that could no longer download from YouTube at all. `yt-dlp[default]` pulls in `yt-dlp-ejs` (the challenge-solver scripts). Keep yt-dlp current when downloads start failing.

## Development Setup

### Package Management
- Use `uv` for all Python operations (`uv sync`, `uv add`, `uv run`)
- Requires Python >=3.10

### Environment Variables
Spotify API credentials live in `.env` (gitignored), loaded via `set -a && source .env && set +a` or by sync_cron.sh:
```bash
SPOTIPY_CLIENT_ID / SPOTIPY_CLIENT_SECRET
```

### Tests and Lint
```bash
make tests          # clean + pytest with coverage
pytest tests/       # directly
pytest tests/test_youtube.py -k test_name   # single test
flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
```
Tests require Spotify credentials in the environment and ffmpeg installed.

### Running Downloads
```bash
# One-off playlist download (creates a subfolder named after the playlist under -o)
uv run spotify_dl -l <playlist_url> -o <output_dir> -mc 4 -w

# Playlist sync using folders.json mapping
uv run spotify_dl --sync --config sync_config.json -mc 4

# Test sync with limits / dry run
uv run spotify_dl --sync --config sync_config.json --limit-playlists 2 --limit 5
uv run spotify_dl --sync --config sync_config.json --dry-run

# Repair: reconcile manifest against what's actually on disk
uv run spotify_dl --repair --config sync_config.json --dry-run
```
Key flags: `-mc N` parallel download processes, `-w` no-overwrite, `-l` accepts multiple URLs in one run.

### SoundCloud URLs
`-l` also accepts SoundCloud track and set/playlist URLs (mixed freely with Spotify URLs). These bypass the Spotify-metadata + YouTube-search pipeline entirely — `soundcloud.py` hands the URL straight to yt-dlp, which supplies audio and metadata natively. Sets get a folder named after the set; single tracks land directly in the output dir. `-w` skips re-downloads via a `.sc_archive.txt` download-archive file in the save dir (the converted MP3's existence can't be detected by yt-dlp). `-mc N` downloads a set's tracks with N concurrent threads (ThreadPoolExecutor, not the multiprocessing machinery the Spotify path uses).

### Nightly Sync (currently DISABLED)
`sync_cron.sh` is the 3am cron entry point, but the crontab line is commented out (`# DISABLED: 0 3 * * * ...`) — the feature isn't active yet. The script exports `/opt/homebrew/bin` onto PATH (cron's minimal PATH can't find deno otherwise), loads `.env`, and runs sync with `-mc 4`, logging to `logs/sync.log`. Re-enable by uncommenting in `crontab -e`.

## Architecture

### Core Flow
1. **CLI Entry** (`spotify_dl.py`): Parses arguments; dispatches to download, sync, or repair mode
2. **Spotify Metadata** (`spotify.py`): Fetches track information from Spotify API (paginated)
3. **YouTube Search & Download** (`youtube.py`): Searches YouTube Music via ytmusicapi, picks the best match by Levenshtein distance (`utils.py`), downloads with yt-dlp, converts to MP3, applies ID3 tags + album art
4. **Playlist Sync** (`sync.py`): Keeps local directories in sync with Spotify playlists

### Sync Mode (`sync.py`)
- `run_sync()` compares Spotify playlists against a manifest file (`.spotify_dl_manifest.json`) tracking downloaded songs, playlist membership, and cached playlist URLs
- Songs download once to a cache directory, then are **copied** into each playlist folder so folders are self-contained
- `folders.json` maps folder names → playlist names; playlists are looked up by name from the configured `spotify_user_id`
- Downloads happen in batches (`batch_size` config, default 25) — batching is for manifest checkpointing, not parallelism; parallelism comes from `-mc`
- `run_repair()` reconciles the manifest when it drifts from disk (e.g. manifest says synced but folders are empty after failed download eras)

### Multiprocessing
`-mc N` splits the song list statically across N `multiprocessing.Process` workers (capped at cores-1). Each worker writes a numbered temp reference file (`0.txt`, `1.txt`, …) in the CWD — leftover numbered .txt files in the repo root are debris from interrupted runs and safe to delete.

### Fork-Specific Behavior (not in upstream)
- WebM orphan recovery: failed MP3 conversions are retried from leftover .webm files
- Postprocessor lists are `.copy()`ed per song (upstream has a shared-list mutation bug)
- Search results without an artist are filtered out before Levenshtein matching

## Repo Layout Notes
- `sync_output/` — the sync target (gitignored, large); organized as `<folder>/<playlist>/` per folders.json
- `old_downloads/` — holding pen for one-off download outputs that used to litter the repo root (gitignored)
- `sync_config.json`, `folders.json`, `.env` — local config, all gitignored (see `example_sync_config.json`)

## Known Issues

### Spotify API not returning some playlists
Playlists with Japanese brackets `「」` and some special Unicode characters are not returned by the Spotify `user_playlists()` API, even though they exist and are public. Affected playlists show "Could not find playlist" during sync. Workaround: rename the playlist to use standard characters.
