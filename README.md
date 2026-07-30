# spotify-dl (Personal Fork)

Downloads songs from Spotify playlists, albums, or tracks by fetching metadata and downloading from YouTube.

> **Fork of [SathyaBhat/spotify-dl](https://github.com/SathyaBhat/spotify-dl)** with added playlist sync functionality for offline DJ libraries.

## What This Fork Adds

- **Playlist Sync Mode**: Keep local folders in sync with Spotify playlists
- **Folder Organization**: Group playlists into folders via `folders.json` mapping
- **Playlist Lookup by Name**: Reference playlists by name instead of URLs
- **Cron-friendly**: Designed for automated daily syncs
- **SoundCloud support**: Pass SoundCloud track or set URLs to `-l` alongside Spotify URLs

## Prerequisites

- Python 3.8+
- ffmpeg (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Ubuntu)
- Spotify API credentials from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)

## Quick Start

### Installation

```bash
pip install spotify_dl
```

Or clone this repo and install in editable mode:
```bash
git clone https://github.com/c2keesey/spotify-dl.git
cd spotify-dl
pip install -e .
```

### Set up Spotify credentials

```bash
export SPOTIPY_CLIENT_ID='your-client-id'
export SPOTIPY_CLIENT_SECRET='your-client-secret'
```

### Basic usage

```bash
# Download a playlist
spotify_dl -l https://open.spotify.com/playlist/xxxxx -o ./music

# Custom folder name (instead of the auto-derived playlist/album/track name)
spotify_dl -l playlist_url -o ./music -n "My Mix"

# Parallel download (4 cores)
spotify_dl -mc 4 -l playlist_url

# With SponsorBlock (skip intros/outros)
spotify_dl -s y -l playlist_url
```

## Playlist Sync Mode

The main feature of this fork. Keep local directories in sync with your Spotify playlists - great for maintaining an offline library for DJ software.

### How it works

1. Resolves each Spotify track to a strict, auditable YouTube Music match
2. Downloads the exact approved video ID once to a shared cache
3. Rejects ambiguous title, artist, duration, and version conflicts
4. Copies verified songs to individual playlist folders
5. Tracks source provenance and match scores for incremental syncs

Only cache entries whose `match_status` is `verified` or `manual` are safe for
downstream consumers. Missing, legacy, `ambiguous`, and `rejected` entries must
be treated as unavailable. The full decision—including Spotify metadata,
selected YouTube video ID, normalized comparisons, scores, duration delta,
runner-up margin, resolver version, and timestamp—is stored in
`.spotify_dl_manifest.json`. Reusable decisions and manual overrides are stored
in `.spotify_dl_matches.json`.

Audio-content matching is disabled and cannot auto-approve a source. Metadata
gates are the only automatic approval path.

### Config file

Create `sync_config.json`:

```json
{
  "output_dir": "~/Music/spotify-sync",
  "spotify_user_id": "YOUR_SPOTIFY_USER_ID",
  "folders_file": "folders.json",
  "cookies_from_browser": "chrome",
  "cookies_browser_profile": "Profile 1",
  "youtube_hls_fallback": true,
  "download_retries": 10,
  "retry_backoff_seconds": 2,
  "retry_backoff_max_seconds": 60
}
```

| Field | Description |
|-------|-------------|
| `output_dir` | Where to store downloaded music |
| `spotify_user_id` | Your Spotify user ID (for playlist lookup by name) |
| `folders_file` | Optional. Path to folder organization file |
| `cookies_from_browser` | Optional. Let yt-dlp read cookies directly from this browser; no cookie values are stored in the config |
| `cookies_browser_profile` | Optional. Profile name/path to use instead of the browser's default profile |
| `youtube_hls_fallback` | Optional. If the preferred audio-only stream returns 403, retry the same approved video ID through a 480p-or-lower HLS stream and extract its 128 kbps AAC audio |
| `youtube_hls_preferred` | Optional. Try the authenticated HLS stream first, then the audio-only stream. Useful when audio-only requests consistently require a PO token |
| `youtube_progressive_fallback` | Optional. After configured authenticated attempts fail, retry the same approved video ID through a cookie-free Android-VR progressive stream |
| `download_retries` | Optional. HTTP/file retries inside yt-dlp (default 10) |
| `fragment_retries` | Optional. HLS fragment retries inside yt-dlp (default 10) |
| `extractor_retries` | Optional. Metadata extraction retries inside yt-dlp (default 5) |
| `retry_backoff_seconds` | Optional. Initial retry delay for HTTP, fragment, file, and extraction failures (default 2 seconds) |
| `retry_backoff_max_seconds` | Optional. Maximum exponential retry delay (default 60 seconds) |
| `sleep_interval_requests` | Optional. Delay between extraction requests (default 1 second) |
| `sleep_interval` | Optional. Minimum randomized delay before a download (default 1 second) |
| `max_sleep_interval` | Optional. Maximum randomized delay before a download (default 3 seconds) |

### Running sync

```bash
# Full sync
spotify_dl --sync --config sync_config.json

# Dry run (preview what would happen)
spotify_dl --sync --config sync_config.json --dry-run

# Limit for testing
spotify_dl --sync --config sync_config.json --limit-playlists 2 --limit 5

# Audit source matches without downloading or trusting opaque cached audio
spotify_dl --sync --audit-matches --config sync_config.json
```

### Manual match decisions

Use a Spotify track ID and the YouTube video ID (the value after `v=`), then run
sync again:

```bash
# Persist an approval
spotify_dl -o ~/Music/spotify-sync --approve-match SPOTIFY_ID YOUTUBE_VIDEO_ID

# Persist a rejection
spotify_dl -o ~/Music/spotify-sync --reject-match SPOTIFY_ID
```

Pass `--match-store PATH` when the decision file is not under `--output`.

`--audit-matches` emits decisions for current playlists and older cache entries
without downloading. A legacy file remains `stale` and unavailable unless its
existing manifest provenance already names the same approved YouTube video ID.

### CLI flags

| Flag | Description |
|------|-------------|
| `--sync` | Enable sync mode |
| `--config PATH` | Path to sync config file |
| `--dry-run` | Preview changes without downloading |
| `--limit N` | Max songs per playlist (for testing) |
| `--limit-playlists N` | Max playlists to process (for testing) |
| `--audit-matches` | Persist source decisions without downloading |
| `--approve-match SPOTIFY_ID VIDEO_ID` | Persist a manual approval |
| `--reject-match SPOTIFY_ID` | Persist a manual rejection |
| `--match-store PATH` | Override the match decision file |

## Folder Organization

Organize playlists into folders using a `folders.json` file in the project root (see `folders.json.example`):

```json
{
  "House": [
    "Deep House Vibes",
    "Tech House Essentials"
  ],
  "Bass": [
    "Dubstep Bangers",
    "DnB Favorites"
  ]
}
```

This creates a folder structure like:
```
output_dir/
  House/
    Deep House Vibes/
      song1.mp3
      song2.mp3
    Tech House Essentials/
      ...
  Bass/
    ...
```

Playlists are matched by name from your Spotify library.

## Automated Sync (Cron)

Example cron job for daily sync at 3am:

```bash
# crontab -e
0 3 * * * /path/to/sync_cron.sh >> /var/log/spotify_sync.log 2>&1
```

See `sync_cron.sh` for an example script.

## Known Limitations

- **Japanese brackets in playlist names**: Spotify's API doesn't return playlists with certain Unicode characters like `「」` in their names. Workaround: rename the playlist to use standard characters.

## Credits

This is a fork of [SathyaBhat/spotify-dl](https://github.com/SathyaBhat/spotify-dl). See the [original contributors](https://github.com/SathyaBhat/spotify-dl/graphs/contributors).

## License

MIT
