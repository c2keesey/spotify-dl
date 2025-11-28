#!/usr/bin/env python3
"""
Reconcile cache MP3 files with manifest.

Finds MP3s in cache that aren't tracked in the manifest,
matches them to Spotify tracks, and updates the manifest.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

from spotify_dl.scaffold import get_tokens
from spotify_dl.sync import (
    load_config,
    load_manifest,
    save_manifest,
    fetch_user_playlists,
    find_playlist_by_name,
    generate_filename,
)
from spotify_dl.spotify import fetch_tracks


def build_track_lookup(sp, config, manifest):
    """
    Build a lookup dict: filename -> (spotify_id, track_info)
    by fetching all tracks from all playlists.
    """
    lookup = {}

    # Get playlist names from folders config
    playlist_names = config.get("_playlist_names", set())
    user_id = config.get("spotify_user_id")

    if not playlist_names or not user_id:
        print("No playlist names or user_id in config")
        return lookup

    print(f"Fetching playlists for user: {user_id}")
    user_playlists = fetch_user_playlists(sp, user_id)
    print(f"Found {len(user_playlists)} playlists")

    processed = 0
    for name in playlist_names:
        # Check manifest cache for playlist URL
        if name in manifest.get("playlist_url_cache", {}):
            cached = manifest["playlist_url_cache"][name]
            playlist_id = cached["id"]
        else:
            playlist_id, _ = find_playlist_by_name(user_playlists, name)
            if playlist_id is None:
                continue

        print(f"  Fetching tracks from: {name}")
        try:
            tracks = fetch_tracks(sp, "playlist", playlist_id)
            for track in tracks:
                filename = generate_filename(track) + ".mp3"
                spotify_id = track["spotify_id"]
                # Store first occurrence (in case of duplicates across playlists)
                if filename not in lookup:
                    lookup[filename] = (spotify_id, track)
            processed += 1
        except Exception as e:
            print(f"    Error fetching {name}: {e}")

    print(f"Processed {processed} playlists, found {len(lookup)} unique tracks")
    return lookup


def reconcile(config_path, dry_run=False):
    """Main reconciliation function."""
    config = load_config(config_path)
    output_dir = Path(config["output_dir"])
    cache_dir = output_dir / ".cache"

    if not cache_dir.exists():
        print(f"Cache directory not found: {cache_dir}")
        return

    manifest = load_manifest(output_dir)

    # Get tracked filenames
    tracked_filenames = set(
        entry["filename"] for entry in manifest.get("cache", {}).values()
    )

    # Get actual MP3 files in cache
    cache_mp3s = set(f.name for f in cache_dir.glob("*.mp3"))

    # Find untracked MP3s
    untracked = cache_mp3s - tracked_filenames

    print(f"Cache MP3 files: {len(cache_mp3s)}")
    print(f"Tracked in manifest: {len(tracked_filenames)}")
    print(f"Untracked MP3s: {len(untracked)}")

    if not untracked:
        print("All cache files are tracked. Nothing to reconcile.")
        return

    # Initialize Spotify client
    tokens = get_tokens()
    if tokens is None:
        sys.exit(1)
    client_id, client_secret = tokens

    sp = spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(
            client_id=client_id, client_secret=client_secret
        )
    )

    # Build lookup from all playlists
    print("\nBuilding track lookup from Spotify playlists...")
    lookup = build_track_lookup(sp, config, manifest)

    # Match untracked files
    matched = 0
    unmatched = []

    print("\nMatching untracked files...")
    for filename in sorted(untracked):
        if filename in lookup:
            spotify_id, track = lookup[filename]
            matched += 1

            if not dry_run:
                manifest["cache"][spotify_id] = {
                    "name": track["name"],
                    "artist": track["artist"],
                    "filename": filename,
                    "downloaded_at": datetime.now().isoformat(),
                    "reconciled": True,  # Mark as reconciled
                }
        else:
            unmatched.append(filename)

    print(f"\nMatched: {matched}")
    print(f"Unmatched: {len(unmatched)}")

    if unmatched and len(unmatched) <= 20:
        print("\nUnmatched files:")
        for f in unmatched:
            print(f"  {f}")
    elif unmatched:
        print(f"\nFirst 10 unmatched files:")
        for f in unmatched[:10]:
            print(f"  {f}")

    if dry_run:
        print("\nDry run - no changes made")
    else:
        save_manifest(output_dir, manifest)
        print(f"\nManifest updated with {matched} new entries")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Reconcile cache with manifest")
    parser.add_argument(
        "--config", "-c",
        default="sync_config.json",
        help="Path to sync config file"
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Show what would be done without making changes"
    )
    args = parser.parse_args()

    reconcile(args.config, dry_run=args.dry_run)
