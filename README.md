# spotify-dl (Personal Fork)

Downloads songs from Spotify playlists, albums, or tracks by fetching metadata and downloading from YouTube.

> **Fork of [SathyaBhat/spotify-dl](https://github.com/SathyaBhat/spotify-dl)** with added playlist sync functionality for offline DJ libraries.

## What This Fork Adds

- **Playlist Sync Mode**: Keep local folders in sync with Spotify playlists
- **Folder Organization**: Group playlists into folders via `folders.json` mapping
- **Playlist Lookup by Name**: Reference playlists by name instead of URLs
- **Cron-friendly**: Designed for automated daily syncs

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

# Parallel download (4 cores)
spotify_dl -mc 4 -l playlist_url

# With SponsorBlock (skip intros/outros)
spotify_dl -s y -l playlist_url
```

## Playlist Sync Mode

The main feature of this fork. Keep local directories in sync with your Spotify playlists - great for maintaining an offline library for DJ software.

### How it works

1. Downloads each song once to a shared cache
2. Copies songs to individual playlist folders (self-contained, USB-drive ready)
3. Tracks what's been downloaded to enable incremental syncs
4. Detects additions and removals from playlists

### Config file

Create `sync_config.json`:

```json
{
  "output_dir": "~/Music/spotify-sync",
  "spotify_user_id": "YOUR_SPOTIFY_USER_ID",
  "folders_file": "folders.json"
}
```

| Field | Description |
|-------|-------------|
| `output_dir` | Where to store downloaded music |
| `spotify_user_id` | Your Spotify user ID (for playlist lookup by name) |
| `folders_file` | Optional. Path to folder organization file |

### Running sync

```bash
# Full sync
spotify_dl --sync --config sync_config.json

# Dry run (preview what would happen)
spotify_dl --sync --config sync_config.json --dry-run

# Limit for testing
spotify_dl --sync --config sync_config.json --limit-playlists 2 --limit 5
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--sync` | Enable sync mode |
| `--config PATH` | Path to sync config file |
| `--dry-run` | Preview changes without downloading |
| `--limit N` | Max songs per playlist (for testing) |
| `--limit-playlists N` | Max playlists to process (for testing) |

## Folder Organization

Organize playlists into folders using a `folders.json` file:

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
