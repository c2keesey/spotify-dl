# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spotify-dl downloads songs from Spotify playlists, albums, or tracks by fetching metadata from the Spotify API and downloading audio from YouTube using yt-dlp. It supports MP3 conversion with metadata tagging, parallel downloads, and optional SponsorBlock integration.

## Development Setup

### Package Management
- Use `uv` for all Python operations (not pip)
- Install dependencies: `uv add <package>` instead of `pip install`
- Install in editable mode: `pip install -e .` (for now, as shown in Makefile)

### Environment Variables
Required Spotify API credentials (get from https://developer.spotify.com/dashboard):
```bash
export SPOTIPY_CLIENT_ID='your-spotify-client-id'
export SPOTIPY_CLIENT_SECRET='your-spotify-client-secret'
```

### Running Tests
```bash
make tests          # Run all tests with coverage
pytest tests/       # Run tests directly
```

The Makefile also runs `make clean` first to remove cached files and test artifacts.

### Linting
```bash
flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
flake8 . --count --exit-zero --max-complexity=10 --max-line-length=127 --statistics
```

### Running the Application
```bash
spotify_dl -l <playlist_url> -o <output_directory>
spotify_dl -mc 4 -l <playlist_url>  # Parallel download with 4 cores
spotify_dl -s y -l <playlist_url>   # Enable SponsorBlock
```

### Running Playlist Sync
```bash
# Full sync using folders.json playlist mapping
spotify_dl --sync --config sync_config.json

# Test with limits
spotify_dl --sync --config sync_config.json --limit-playlists 2 --limit 5

# Dry run (show what would happen)
spotify_dl --sync --config sync_config.json --dry-run
```

Config file (`sync_config.json`):
```json
{
  "output_dir": "/path/to/output",
  "spotify_user_id": "your_spotify_user_id",
  "folders_file": "folders.json"
}
```

Cron job runs at 3am daily via `sync_cron.sh`.

## Architecture

### Core Flow
1. **CLI Entry** (`spotify_dl.py`): Parses arguments and orchestrates the download process
2. **Spotify Metadata** (`spotify.py`): Fetches track information from Spotify API
3. **YouTube Search & Download** (`youtube.py`): Searches YouTube Music using ytmusicapi, downloads with yt-dlp
4. **Tagging** (`youtube.py`): Applies ID3 tags and album art to downloaded MP3s
5. **Playlist Sync** (`sync.py`): Keeps local directories in sync with Spotify playlists

### Key Modules

**spotify.py**
- `fetch_tracks()`: Retrieves track metadata from Spotify (handles playlists, albums, tracks)
- `parse_spotify_url()`: Parses Spotify URLs to extract item type and ID
- Uses pagination for large playlists (offset-based)
- Fetches genre from artist info

**youtube.py**
- `download_songs()`: Main download orchestrator, creates reference CSV file
- `find_and_download_songs()`: Core download logic using ytmusicapi for search
- `multicore_find_and_download_songs()`: Divides work across CPU cores
- Uses Levenshtein distance (`utils.py`) to find best YouTube Music match
- `set_tags()`: Applies MP3 metadata (album art, genre, track number, BPM)

**scaffold.py**
- Logging setup with Rich library
- `get_tokens()`: Validates environment variables for Spotify credentials
- Sentry SDK integration for error tracking

**utils.py**
- `sanitize()`: Removes filesystem-reserved characters from filenames
- `get_closest_match()`: Levenshtein-based fuzzy matching for search results

**sync.py**
- `run_sync()`: Main sync orchestrator - compares Spotify playlists with local state
- `load_config()` / `load_manifest()` / `save_manifest()`: Config and state management
- `download_to_cache()`: Downloads songs to cache directory
- `fetch_user_playlists()`: Fetches all playlists for a Spotify user
- `find_playlist_by_name()`: Looks up playlist by name from user's playlists
- Uses manifest file (`.spotify_dl_manifest.json`) to track downloaded songs, playlist membership, and cached playlist URLs
- Copies files from cache to each playlist folder for self-contained directories
- Supports folder organization via `folders.json` mapping (folder → playlist names)
- Supports `--limit` (max songs) and `--limit-playlists` (max playlists) for testing

### Data Flow
1. Parse Spotify URLs → validate item types (playlist/album/track)
2. Fetch track metadata from Spotify API (name, artist, album, year, etc.)
3. Write tracks to CSV reference file (`downloaded_songs.txt`)
4. For each track:
   - Search YouTube Music using ytmusicapi
   - Use Levenshtein distance to pick best match
   - Download with yt-dlp
   - Convert to MP3 (optional)
   - Apply ID3 tags and album art

### Multiprocessing
When `-mc` flag is used:
- Divides song list among CPU cores
- Each process gets its own reference file segment
- Processes run in parallel using `multiprocessing.Process`

## Key Dependencies
- `spotipy`: Spotify API client
- `yt-dlp`: YouTube downloader (fork of youtube-dl)
- `ytmusicapi`: YouTube Music search
- `mutagen`: MP3 metadata tagging
- `Levenshtein`: Fuzzy string matching
- `rich`: Terminal UI (progress bars, formatting)

## Testing Notes
Tests require:
- Spotify API credentials in environment
- ffmpeg installed (`sudo apt install ffmpeg` on Ubuntu)
- Test files are in `tests/` directory

## Known Issues

### Spotify API not returning some playlists
Playlists with Japanese brackets `「」` and some special Unicode characters are not returned by the Spotify `user_playlists()` API, even though they exist and are public. This appears to be a Spotify API limitation. Affected playlists will show "Could not find playlist" during sync. Workaround: rename the playlist to use standard characters.
