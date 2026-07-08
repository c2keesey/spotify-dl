"""Thin wrapper over pyrekordbox + dedup logic.

Reads rekordbox's collection (BPM/key analysis), imports downloaded tracks
(dedup-first, additive-only), and writes sets as NEW playlists. Every write
is guarded: refuses while rekordbox runs, backs up master.db first.
"""

import re
import shutil
import time
from pathlib import Path

from spotify_dl.dj import to_camelot

MASTER_DB = Path.home() / "Library/Pioneer/rekordbox/master.db"

# strip "feat./featuring/ft." credits and remaster-noise; KEEP remix/vip/edit
# (those are genuinely different tracks to a DJ).
FEAT_RE = re.compile(r"[\(\[]?\s*\b(?:feat\.?|featuring|ft\.?)\s+[^)\]]*[\)\]]?", re.I)
NOISE_RE = re.compile(r"[\(\[][^)\]]*(?:remaster|anniversary edition|deluxe)[^)\]]*[\)\]]", re.I)


def _squash(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def norm_title(s):
    return _squash(NOISE_RE.sub("", FEAT_RE.sub("", s or "")))


def norm_artist(s):
    return _squash(FEAT_RE.sub("", s or ""))


def file_tags(path):
    """(artist, title, duration_seconds) from a file's ID3 tags, best-effort.
    Falls back to the filename stem as title."""
    try:
        from mutagen.easyid3 import EasyID3
        from mutagen.mp3 import MP3
        audio = MP3(path, ID3=EasyID3)
        artist = (audio.get("artist") or [""])[0]
        title = (audio.get("title") or [""])[0]
        return artist, title or Path(path).stem, audio.info.length
    except Exception:  # noqa: BLE001 - unreadable tags just mean weaker matching
        return "", Path(path).stem, None


def _artists_match(a1, a2):
    """Match if equal or one contains the other (collab strings like
    'KAYTRANADA, H.E.R.' vs 'KAYTRANADA'). Empty matches anything."""
    a1, a2 = norm_artist(a1), norm_artist(a2)
    if not a1 or not a2:
        return True
    return a1 == a2 or a1 in a2 or a2 in a1


def _durations_similar(d1, d2, tol=5.0):
    if not d1 or not d2:
        return True
    return abs(d1 - d2) <= tol


def find_duplicates(paths, existing):
    """Split candidate file paths into (new, dupes) against existing collection
    records. THE dedup gate: runs before every import, always."""
    by_path = {r["file_path"] for r in existing}
    by_title = {}
    for r in existing:
        by_title.setdefault(norm_title(r["title"]), []).append(r)

    new, dupes = [], []
    for p in paths:
        p = str(p)
        if p in by_path:
            dupes.append({"path": p, "reason": "already in collection (same file)"})
            continue
        artist, title, dur = file_tags(p)
        hit = next(
            (m for m in by_title.get(norm_title(title), [])
             if _artists_match(artist, m["artist"]) and _durations_similar(dur, m["duration"])),
            None,
        )
        if hit:
            dupes.append({"path": p,
                          "reason": f"same song as “{hit['artist']} — {hit['title']}”"})
        else:
            new.append(p)
    return new, dupes
