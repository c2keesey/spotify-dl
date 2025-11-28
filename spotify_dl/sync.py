"""
Playlist sync module for spotify-dl.
Keeps local directories in sync with specified Spotify playlists.
"""
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

from spotify_dl.constants import MANIFEST_FILENAME
from spotify_dl.scaffold import log, get_tokens
from spotify_dl.spotify import fetch_tracks, parse_spotify_url, get_item_name
from spotify_dl.utils import sanitize
from spotify_dl.youtube import download_songs, default_filename


def load_config(config_path):
    """Load and validate sync config file."""
    config_path = os.path.expanduser(config_path)
    if not os.path.exists(config_path):
        log.error("Config file not found: %s", config_path)
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    if "output_dir" not in config:
        log.error("Config missing required 'output_dir' field")
        sys.exit(1)

    config["output_dir"] = os.path.expanduser(config["output_dir"])

    # Load folder mapping if specified
    folder_mapping, playlist_names = load_folder_mapping(config, config_path)
    config["_folder_mapping"] = folder_mapping
    config["_playlist_names"] = playlist_names

    # Either playlists or folders_file must be provided
    has_playlists = "playlists" in config and config["playlists"]
    has_folders = bool(playlist_names)
    if not has_playlists and not has_folders:
        log.error("Config must have 'playlists' or 'folders_file' with playlist names")
        sys.exit(1)

    return config


def load_folder_mapping(config, config_path):
    """
    Load folder mapping from config.
    Supports:
    - 'folders': inline dict mapping folder names to playlist names
    - 'folders_file': path to JSON file with folder mapping
    Returns:
    - reverse_mapping: playlist_name -> folder_name
    - all_playlist_names: set of all playlist names to sync
    """
    folder_mapping = {}

    if "folders_file" in config:
        folders_path = config["folders_file"]
        if not os.path.isabs(folders_path):
            # Relative to config file location
            folders_path = os.path.join(os.path.dirname(config_path), folders_path)
        folders_path = os.path.expanduser(folders_path)

        if os.path.exists(folders_path):
            with open(folders_path, "r", encoding="utf-8") as f:
                folder_mapping = json.load(f)
        else:
            log.warning("Folders file not found: %s", folders_path)

    elif "folders" in config:
        folder_mapping = config["folders"]

    # Build reverse mapping: playlist_name -> folder_name
    # Also collect all playlist names
    reverse_mapping = {}
    all_playlist_names = set()
    for folder_name, playlist_names in folder_mapping.items():
        for name in playlist_names:
            # Strip .json extension if present
            clean_name = name[:-5] if name.endswith(".json") else name
            reverse_mapping[clean_name] = folder_name
            all_playlist_names.add(clean_name)

    return reverse_mapping, all_playlist_names


def get_playlist_folder(playlist_name, folder_mapping):
    """
    Get the folder for a playlist based on the folder mapping.
    Returns the folder name if found, None otherwise.
    """
    return folder_mapping.get(playlist_name)


def fetch_user_playlists(sp, user_id):
    """
    Fetch all playlists for a user.
    Returns a dict mapping playlist_name -> (playlist_id, playlist_url)
    """
    playlists = {}
    offset = 0
    while True:
        results = sp.user_playlists(user_id, limit=50, offset=offset)
        items = results.get("items", [])
        if not items:
            break
        for playlist in items:
            if playlist:
                name = playlist.get("name")
                playlist_id = playlist["id"]
                playlist_url = playlist["external_urls"]["spotify"]
                playlists[name] = (playlist_id, playlist_url)
        offset += len(items)
        if not results.get("next"):
            break
    return playlists


def find_playlist_by_name(user_playlists, playlist_name):
    """
    Find a playlist by name from user's playlists.
    Returns (playlist_id, playlist_url) if found, (None, None) otherwise.
    """
    # Exact match
    if playlist_name in user_playlists:
        return user_playlists[playlist_name]

    # Case-insensitive match
    for name, info in user_playlists.items():
        if name.lower() == playlist_name.lower():
            return info

    return None, None


def load_manifest(output_dir):
    """Load manifest or return empty structure if not exists."""
    manifest_path = Path(output_dir) / MANIFEST_FILENAME
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"version": 1, "cache": {}, "playlists": {}}


def save_manifest(output_dir, manifest):
    """Atomically write manifest (write to temp, then rename)."""
    manifest_path = Path(output_dir) / MANIFEST_FILENAME
    fd, tmp_path = tempfile.mkstemp(dir=output_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        os.replace(tmp_path, manifest_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def generate_filename(track, max_bytes=200):
    """
    Generate filename using existing default_filename pattern.
    Truncates to max_bytes to avoid filesystem limits (macOS: 255 bytes).
    Leaves room for .mp3 extension and some buffer.
    """
    filename = default_filename(name=track["name"], artist=track["artist"])

    # Truncate if too long (accounting for multibyte characters)
    encoded = filename.encode('utf-8')
    if len(encoded) > max_bytes:
        # Truncate and decode safely
        truncated = encoded[:max_bytes].decode('utf-8', errors='ignore')
        # Remove any partial character at the end
        filename = truncated.rstrip()

    return filename


def download_to_cache_batch(tracks, cache_dir, config, multi_core=0):
    """
    Download multiple songs to cache directory using multi-core support.
    Returns dict mapping spotify_id -> filename for successful downloads.

    Args:
        tracks: List of (spotify_id, track_dict) tuples
        cache_dir: Path to cache directory
        config: Sync configuration dict
        multi_core: Number of CPU cores to use (0 = single core)
    """
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Filter out tracks already in cache
    to_download = []
    results = {}
    for spotify_id, track in tracks:
        filename = generate_filename(track) + ".mp3"
        file_path = cache_dir / filename
        if file_path.exists():
            log.info("Already in cache: %s", filename)
            results[spotify_id] = filename
        else:
            to_download.append((spotify_id, track, filename))

    if not to_download:
        return results

    # Prepare batch for download_songs
    songs_list = [track for _, track, _ in to_download]
    songs_data = {"urls": [{"save_path": cache_dir, "songs": songs_list}]}

    log.info("Downloading %d songs with %d cores", len(to_download), multi_core or 1)

    try:
        download_songs(
            songs=songs_data,
            output_dir=str(cache_dir),
            format_str=config.get("format_str", "bestaudio/best"),
            skip_mp3=config.get("skip_mp3", False),
            keep_playlist_order=False,
            no_overwrites=True,
            remove_trailing_tracks="n",
            use_sponsorblock=config.get("use_sponsorblock", "no"),
            file_name_f=default_filename,
            multi_core=multi_core,
            proxy=config.get("proxy", ""),
            cookies_from_browser=config.get("cookies_from_browser"),
        )
    except Exception as e:
        log.error("Batch download error: %s", e)

    # Check which downloads succeeded
    for spotify_id, track, filename in to_download:
        file_path = cache_dir / filename
        if file_path.exists():
            results[spotify_id] = filename
        else:
            log.warning("Download may have failed for: %s", track["name"])

    return results


def run_sync(config_path, dry_run=False, limit=0, limit_playlists=0, multi_core=0):
    """
    Main sync function.
    Fetches current playlist state from Spotify and syncs local directories.

    Args:
        config_path: Path to sync config file
        dry_run: If True, show what would happen without making changes
        limit: Max songs to download (0 = no limit)
        limit_playlists: Max playlists to process (0 = no limit)
        multi_core: Number of CPU cores for parallel downloads (0 = single core)
    """
    config = load_config(config_path)
    output_dir = Path(config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = load_manifest(output_dir)
    cache_dir = output_dir / ".cache"

    tokens = get_tokens()
    if tokens is None:
        sys.exit(1)
    client_id, client_secret = tokens

    sp = spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(
            client_id=client_id, client_secret=client_secret
        )
    )

    # Initialize playlist_url_cache in manifest if not present
    if "playlist_url_cache" not in manifest:
        manifest["playlist_url_cache"] = {}

    # Build list of playlists to sync
    # Either from URLs in config, or by looking up names from folders_file
    playlists_to_sync = []  # List of (playlist_id, playlist_url, playlist_name)

    # First, add any explicit playlist URLs from config
    for playlist_url in config.get("playlists", []):
        item_type, playlist_id = parse_spotify_url(playlist_url)
        if item_type != "playlist":
            log.warning("Skipping non-playlist URL: %s", playlist_url)
            continue
        playlist_name = get_item_name(sp, item_type, playlist_id)
        playlists_to_sync.append((playlist_id, playlist_url, playlist_name))

    # Then, look up playlists from folders_file by name
    playlist_names_to_find = config.get("_playlist_names", set())
    if playlist_names_to_find:
        # Fetch user's playlists if spotify_user_id is configured
        user_id = config.get("spotify_user_id")
        if not user_id:
            log.error("'spotify_user_id' required in config to look up playlists by name")
            sys.exit(1)

        log.info("Fetching playlists for user: %s", user_id)
        user_playlists = fetch_user_playlists(sp, user_id)
        log.info("Found %d playlists", len(user_playlists))

        for name in playlist_names_to_find:
            # Check if we already have this playlist from URLs
            if any(p[2] == name for p in playlists_to_sync):
                continue

            # Check manifest cache first
            if name in manifest["playlist_url_cache"]:
                cached = manifest["playlist_url_cache"][name]
                playlist_id = cached["id"]
                playlist_url = cached["url"]
            else:
                # Find in user's playlists
                playlist_id, playlist_url = find_playlist_by_name(user_playlists, name)
                if playlist_id is None:
                    log.warning("Could not find playlist: %s", name)
                    continue
                # Cache the found URL
                manifest["playlist_url_cache"][name] = {
                    "id": playlist_id,
                    "url": playlist_url,
                }
                save_manifest(output_dir, manifest)

            playlists_to_sync.append((playlist_id, playlist_url, name))

    # Apply playlist limit
    if limit_playlists and len(playlists_to_sync) > limit_playlists:
        log.info("Limiting to %d playlists (of %d total)", limit_playlists, len(playlists_to_sync))
        playlists_to_sync = playlists_to_sync[:limit_playlists]

    log.info("Syncing %d playlists to %s", len(playlists_to_sync), output_dir)

    playlist_songs = {}
    playlist_names = {}

    for playlist_id, playlist_url, playlist_name in playlists_to_sync:
        playlist_names[playlist_id] = playlist_name
        log.info("Fetching tracks from: %s", playlist_name)

        tracks = fetch_tracks(sp, "playlist", playlist_id)
        playlist_songs[playlist_id] = {t["spotify_id"]: t for t in tracks}

        folder = get_playlist_folder(playlist_name, config.get("_folder_mapping", {}))
        if playlist_id not in manifest["playlists"]:
            manifest["playlists"][playlist_id] = {
                "name": playlist_name,
                "url": playlist_url,
                "folder": folder,
                "songs": [],
                "last_synced": None,
            }
        else:
            # Update folder if changed
            manifest["playlists"][playlist_id]["folder"] = folder

    total_to_download = 0
    total_to_copy = 0
    total_to_remove = 0

    actions = {}

    folder_mapping = config.get("_folder_mapping", {})

    for playlist_id, songs in playlist_songs.items():
        playlist_name = playlist_names[playlist_id]
        folder = get_playlist_folder(playlist_name, folder_mapping)
        if folder:
            playlist_dir = output_dir / sanitize(folder) / sanitize(playlist_name)
        else:
            playlist_dir = output_dir / sanitize(playlist_name)

        prev_songs = set(manifest["playlists"].get(playlist_id, {}).get("songs", []))
        curr_songs = set(songs.keys())

        to_add = curr_songs - prev_songs
        to_remove = prev_songs - curr_songs

        needs_download = [sid for sid in to_add if sid not in manifest["cache"]]
        needs_copy = [sid for sid in to_add if sid in manifest["cache"]]

        total_to_download += len(needs_download)
        total_to_copy += len(needs_copy)
        total_to_remove += len(to_remove)

        actions[playlist_id] = {
            "playlist_name": playlist_name,
            "folder": folder,
            "playlist_dir": playlist_dir,
            "songs": songs,
            "to_add": to_add,
            "to_remove": to_remove,
            "needs_download": needs_download,
            "needs_copy": needs_copy,
        }

    if limit and total_to_download > limit:
        log.info(
            "Sync plan: %d to download (limited to %d), %d to copy from cache, %d to remove",
            total_to_download,
            limit,
            total_to_copy,
            total_to_remove,
        )
    else:
        log.info(
            "Sync plan: %d to download, %d to copy from cache, %d to remove",
            total_to_download,
            total_to_copy,
            total_to_remove,
        )

    if dry_run:
        for playlist_id, action in actions.items():
            if action["folder"]:
                log.info("\n[%s / %s]", action["folder"], action["playlist_name"])
            else:
                log.info("\n[%s]", action["playlist_name"])
            if action["needs_download"]:
                for sid in action["needs_download"]:
                    track = action["songs"][sid]
                    log.info("  + DOWNLOAD: %s - %s", track["artist"], track["name"])
            if action["needs_copy"]:
                for sid in action["needs_copy"]:
                    track = action["songs"][sid]
                    log.info("  + COPY: %s - %s", track["artist"], track["name"])
            if action["to_remove"]:
                for sid in action["to_remove"]:
                    if sid in manifest["cache"]:
                        log.info("  - REMOVE: %s", manifest["cache"][sid]["filename"])
        log.info("\nDry run complete. No changes made.")
        return

    # Phase 1: Collect all songs needing download, then batch download
    all_downloads = []
    for playlist_id, action in actions.items():
        for sid in action["needs_download"]:
            track = action["songs"][sid]
            all_downloads.append((sid, track))

    # Apply download limit
    if limit and len(all_downloads) > limit:
        log.info("Limiting downloads to %d (of %d needed)", limit, len(all_downloads))
        all_downloads = all_downloads[:limit]

    # Batch download with multi-core support
    if all_downloads:
        downloaded = download_to_cache_batch(all_downloads, cache_dir, config, multi_core)

        # Update manifest with successful downloads
        for sid, filename in downloaded.items():
            track = next(t for s, t in all_downloads if s == sid)
            manifest["cache"][sid] = {
                "name": track["name"],
                "artist": track["artist"],
                "filename": filename,
                "downloaded_at": datetime.now().isoformat(),
            }
        save_manifest(output_dir, manifest)

    # Phase 2: Copy cached songs to playlist folders & cleanup
    for playlist_id, action in actions.items():
        playlist_dir = action["playlist_dir"]
        playlist_dir.mkdir(parents=True, exist_ok=True)

        for sid in action["to_add"]:
            if sid not in manifest["cache"]:
                continue
            filename = manifest["cache"][sid]["filename"]
            src = cache_dir / filename
            dst = playlist_dir / filename
            if src.exists() and not dst.exists():
                log.info("Copying to %s: %s", action["playlist_name"], filename)
                shutil.copy2(src, dst)

        for sid in action["to_remove"]:
            if sid in manifest["cache"]:
                filename = manifest["cache"][sid]["filename"]
                file_path = playlist_dir / filename
                if file_path.exists():
                    log.info(
                        "Removing from %s: %s", action["playlist_name"], filename
                    )
                    file_path.unlink()

        manifest["playlists"][playlist_id]["songs"] = list(action["songs"].keys())
        manifest["playlists"][playlist_id]["last_synced"] = datetime.now().isoformat()
        save_manifest(output_dir, manifest)

    log.info("Sync complete!")
