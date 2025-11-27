import os
from pathlib import Path

__all__ = ["VERSION", "MANIFEST_FILENAME", "DEFAULT_SYNC_CONFIG"]

VERSION = "8.9.0"

if os.getenv("XDG_CACHE_HOME") is not None:
    SAVE_PATH = os.getenv("XDG_CACHE_HOME") + "/spotifydl"
else:
    SAVE_PATH = str(Path.home()) + "/.cache/spotifydl"

DOWNLOAD_LIST = "download_list.log"
MANIFEST_FILENAME = ".spotify_dl_manifest.json"
DEFAULT_SYNC_CONFIG = str(Path.home() / ".spotify_dl_sync.json")
