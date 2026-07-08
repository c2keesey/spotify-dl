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


# ---- read layer ----

def is_rekordbox_running():
    from pyrekordbox.utils import get_rekordbox_pid
    return get_rekordbox_pid() != 0


def open_db():
    """Open the live rekordbox DB. Import is lazy so pure logic above works
    without pyrekordbox key extraction."""
    from pyrekordbox import Rekordbox6Database
    return Rekordbox6Database()


def _record(c):
    """Normalize a DjmdContent row to the track record the API serves."""
    bpm = (c.BPM or 0) / 100 or None
    key = c.Key.ScaleName if c.Key else None
    path = c.FolderPath or ""
    return {
        "id": str(c.ID),
        "title": c.Title or Path(path).stem,
        "artist": c.Artist.Name if c.Artist else "",
        "bpm": bpm,
        "key_name": key,
        "camelot": to_camelot(key),
        "file_path": path,
        "duration": c.Length or None,
        "status": "analyzed" if (bpm and key) else "pending",
    }


def _playlist_names(db):
    """content id -> [playlist names]."""
    from pyrekordbox.db6 import tables
    names = {}
    rows = (
        db.session.query(tables.DjmdSongPlaylist.ContentID, tables.DjmdPlaylist.Name)
        .join(tables.DjmdPlaylist,
              tables.DjmdSongPlaylist.PlaylistID == tables.DjmdPlaylist.ID)
        .all()
    )
    for cid, name in rows:
        names.setdefault(str(cid), []).append(name)
    return names


def load_tracks():
    """All collection tracks as normalized records (sampler content excluded)."""
    db = open_db()
    try:
        playlists = _playlist_names(db)
        out = []
        for c in db.get_content():
            if "/Sampler/" in (c.FolderPath or ""):
                continue
            rec = _record(c)
            rec["playlists"] = playlists.get(rec["id"], [])
            out.append(rec)
        return out
    finally:
        db.close()


# ---- write guards ----

def backup_master_db():
    """Timestamped copy of master.db next to rekordbox's own backups.
    Called before EVERY write."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = MASTER_DB.with_name(f"master.backup.spotify-dl.{stamp}.db")
    shutil.copy2(MASTER_DB, dest)
    return dest


class RekordboxRunning(RuntimeError):
    """Raised when a write is attempted while rekordbox holds the DB lock."""


def _dedup_within_batch(paths):
    """Second dedup pass, within one import batch: spotify-dl's sync copies
    the same song into multiple playlist folders, so a single batch can
    contain N copies of a song that are all "new" vs the collection. Drop
    later files that match an earlier-accepted file in this batch by the
    same rules used against the collection. Returns (accepted, dupes) where
    accepted is [(path, artist, title, duration), ...]."""
    accepted = []
    dupes = []
    for p in paths:
        artist, title, dur = file_tags(p)
        hit = next(
            (a for a in accepted
             if _artists_match(artist, a[1]) and norm_title(title) == norm_title(a[2])
             and _durations_similar(dur, a[3])),
            None,
        )
        if hit:
            dupes.append({"path": p,
                          "reason": f"duplicate of “{hit[0]}” within this import"})
        else:
            accepted.append((p, artist, title, dur))
    return accepted, dupes


def import_files(paths):
    """Additive-only import: dedup FIRST, then add only genuinely new tracks.
    Never modifies existing rows. Returns {imported, skipped_duplicates}."""
    if is_rekordbox_running():
        raise RekordboxRunning("close rekordbox first")
    existing = load_tracks()
    candidates, dupes = find_duplicates(paths, existing)
    accepted, batch_dupes = _dedup_within_batch(candidates)
    dupes += batch_dupes
    new = [p for p, _artist, _title, _dur in accepted]
    if new:
        backup_master_db()
        db = open_db()
        try:
            for p, _artist, title, _dur in accepted:
                db.add_content(p, Title=title)
            db.commit()
        finally:
            db.close()
    return {"imported": new, "skipped_duplicates": dupes}


def export_playlist(name, track_ids):
    """Write an ordered set as a NEW playlist. Existing playlists are never
    modified; a name collision gets ' (2)', ' (3)', … appended."""
    if not track_ids:
        raise ValueError("empty set")
    if is_rekordbox_running():
        raise RekordboxRunning("close rekordbox first")
    backup_master_db()
    db = open_db()
    try:
        taken = {p.Name for p in db.get_playlist()}
        final, n = name, 2
        while final in taken:
            final = f"{name} ({n})"
            n += 1
        pl = db.create_playlist(final)
        for i, tid in enumerate(track_ids, 1):
            db.add_to_playlist(pl, tid, track_no=i)
        db.commit()
        return {"playlist": final}
    finally:
        db.close()
