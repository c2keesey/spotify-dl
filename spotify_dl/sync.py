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
    if "playlists" not in config or not config["playlists"]:
        log.error("Config missing required 'playlists' field or it's empty")
        sys.exit(1)

    config["output_dir"] = os.path.expanduser(config["output_dir"])
    return config


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


def generate_filename(track):
    """Generate filename using existing default_filename pattern."""
    return default_filename(name=track["name"], artist=track["artist"])


def download_to_cache(track, cache_dir, config):
    """
    Download a single song to cache directory.
    Returns the filename if successful, None otherwise.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    filename = generate_filename(track) + ".mp3"
    file_path = cache_dir / filename

    if file_path.exists():
        log.info("Already in cache: %s", filename)
        return filename

    songs_data = {"urls": [{"save_path": cache_dir, "songs": [track]}]}

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
            multi_core=0,
            proxy=config.get("proxy", ""),
        )
        if file_path.exists():
            return filename
        else:
            log.warning("Download may have failed for: %s", track["name"])
            return None
    except Exception as e:
        log.error("Failed to download %s: %s", track["name"], e)
        return None


def run_sync(config_path, dry_run=False):
    """
    Main sync function.
    Fetches current playlist state from Spotify and syncs local directories.
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

    log.info("Syncing %d playlists to %s", len(config["playlists"]), output_dir)

    playlist_songs = {}
    playlist_names = {}

    for playlist_url in config["playlists"]:
        item_type, playlist_id = parse_spotify_url(playlist_url)
        if item_type != "playlist":
            log.warning("Skipping non-playlist URL: %s", playlist_url)
            continue

        playlist_name = get_item_name(sp, item_type, playlist_id)
        playlist_names[playlist_id] = playlist_name
        log.info("Fetching tracks from: %s", playlist_name)

        tracks = fetch_tracks(sp, item_type, playlist_id)
        playlist_songs[playlist_id] = {t["spotify_id"]: t for t in tracks}

        if playlist_id not in manifest["playlists"]:
            manifest["playlists"][playlist_id] = {
                "name": playlist_name,
                "url": playlist_url,
                "songs": [],
                "last_synced": None,
            }

    total_to_download = 0
    total_to_copy = 0
    total_to_remove = 0

    actions = {}

    for playlist_id, songs in playlist_songs.items():
        playlist_name = playlist_names[playlist_id]
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
            "playlist_dir": playlist_dir,
            "songs": songs,
            "to_add": to_add,
            "to_remove": to_remove,
            "needs_download": needs_download,
            "needs_copy": needs_copy,
        }

    log.info(
        "Sync plan: %d to download, %d to copy from cache, %d to remove",
        total_to_download,
        total_to_copy,
        total_to_remove,
    )

    if dry_run:
        for playlist_id, action in actions.items():
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

    for playlist_id, action in actions.items():
        playlist_dir = action["playlist_dir"]
        playlist_dir.mkdir(parents=True, exist_ok=True)

        for sid in action["needs_download"]:
            track = action["songs"][sid]
            log.info("Downloading: %s - %s", track["artist"], track["name"])
            filename = download_to_cache(track, cache_dir, config)
            if filename:
                manifest["cache"][sid] = {
                    "name": track["name"],
                    "artist": track["artist"],
                    "filename": filename,
                    "downloaded_at": datetime.now().isoformat(),
                }
                save_manifest(output_dir, manifest)

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
