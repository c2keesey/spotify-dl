"""File-based DJ sets: an m3u8 playlist plus a JSON sidecar.

The m3u8 IS the export artifact — portable to Serato/Traktor and importable by
rekordbox — while the sidecar carries Crate-only state (the rekordbox content id
per track and the id of any playlist an export produced). Saving a set and
exporting it are therefore the same write. Nothing here touches master.db, so a
set can be written while rekordbox is running.

Missing-file policy: a track whose file has moved or whose drive is unmounted
keeps its absolute path — the path is a valid pointer, the file is simply not
reachable right now, and the playlist self-heals when the file/drive returns. A
`spotify:track:…` URI is NOT a filesystem path; it is kept in the sidecar (so
Crate never loses it) but omitted from the m3u8 and the XML, and it never
becomes a `file://` Location.
"""

import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def _safe_name(name):
    """Reduce a set name to a single safe filename stem. Never a path: directory
    separators and traversal are stripped so a name like '../../etc/passwd'
    cannot escape the sets directory."""
    stem = os.path.basename((name or "").strip().replace("\\", "/").rstrip("/"))
    stem = re.sub(r"[^\w\s.-]", "_", stem, flags=re.UNICODE)
    stem = stem.strip(". ")
    return stem or "set"


def _is_file_path(path):
    """True only for a real absolute filesystem path. An empty/relative path or
    a spotify:track:… URI is not a file and never becomes an m3u8/XML entry."""
    return bool(path) and os.path.isabs(path)


def _track_path(t):
    return t.get("file_path") or t.get("path") or ""


def _duration_secs(t):
    try:
        return int(round(float(t.get("duration"))))
    except (TypeError, ValueError):
        return -1


def _safe_int(s):
    try:
        return int(round(float(s)))
    except (TypeError, ValueError):
        return None


def _m3u8_text(tracks):
    lines = ["#EXTM3U"]
    for t in tracks:
        path = _track_path(t)
        if not _is_file_path(path):
            continue
        artist = (t.get("artist") or "").strip()
        title = (t.get("title") or "").strip()
        label = f"{artist} - {title}" if artist else title
        lines.append(f"#EXTINF:{_duration_secs(t)},{label}")
        lines.append(path)
    return "\n".join(lines) + "\n"


def save(dir, name, tracks):
    """Write <name>.m3u8 (the portable artifact) and <name>.json (Crate state)
    into `dir`, in set order. Returns the m3u8 Path."""
    d = Path(dir)
    d.mkdir(parents=True, exist_ok=True)
    stem = _safe_name(name)
    m3u8_path = d / f"{stem}.m3u8"
    json_path = d / f"{stem}.json"
    # Security boundary: both files must resolve to inside `dir`, never above it.
    root = d.resolve()
    if m3u8_path.resolve().parent != root or json_path.resolve().parent != root:
        raise ValueError("unsafe set name")

    m3u8_path.write_text(_m3u8_text(tracks), encoding="utf-8")
    sidecar = {
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tracks": [{"id": t.get("id"), "path": _track_path(t)} for t in tracks],
        "rekordbox_playlist_id": None,
    }
    json_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return m3u8_path


def _parse_m3u8(p):
    """Parse a bare m3u8 into the sidecar shape. Its tracks have a path but no
    id (there is nowhere in an m3u8 to record the rekordbox content id)."""
    tracks = []
    pending = {}
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#EXTINF:"):
            secs, _, label = line[len("#EXTINF:"):].partition(",")
            artist, sep, title = label.partition(" - ")
            pending = {"duration": _safe_int(secs),
                       "artist": artist.strip() if sep else "",
                       "title": (title if sep else artist).strip()}
        elif line.startswith("#"):
            continue
        else:
            track = {"id": None, "path": line}
            track.update(pending)
            tracks.append(track)
            pending = {}
    return {"name": p.stem, "created_at": None, "tracks": tracks,
            "rekordbox_playlist_id": None}


def load(path):
    """Read a set. Prefers the JSON sidecar; falls back to parsing the m3u8 when
    the sidecar is absent, so a hand-made m3u8 from another tool opens in Crate."""
    p = Path(path)
    sidecar = p.with_suffix(".json")
    if sidecar.is_file():
        return json.loads(sidecar.read_text(encoding="utf-8"))
    return _parse_m3u8(p)


def list_sets(dir):
    """Summaries of every set in `dir` (one per .m3u8)."""
    d = Path(dir)
    if not d.is_dir():
        return []
    out = []
    for m3u8 in sorted(d.glob("*.m3u8")):
        data = load(m3u8)
        out.append({"name": data.get("name") or m3u8.stem,
                    "path": str(m3u8),
                    "created_at": data.get("created_at"),
                    "track_count": len(data.get("tracks", [])),
                    "rekordbox_playlist_id": data.get("rekordbox_playlist_id")})
    return out


def _fmt_bpm(bpm):
    try:
        return f"{float(bpm):.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _location_url(path):
    """A rekordbox-strict file://localhost/… URL. The path is percent-encoded
    (slashes preserved) so spaces and non-ASCII characters survive import."""
    return "file://localhost" + quote(path)


def to_rekordbox_xml(tracks, playlist_name):
    """A DJ_PLAYLISTS document rekordbox can import: a COLLECTION of TRACK nodes
    plus a PLAYLISTS node referencing them, in order. Streaming-only entries
    (no filesystem path) are omitted. ElementTree escapes all values."""
    included = [t for t in tracks if _is_file_path(_track_path(t))]
    # A stable key per track, shared by the COLLECTION TrackID and the playlist
    # TRACK Key so the reference resolves.
    keyed = [(str(t.get("id") or i), t) for i, t in enumerate(included, 1)]

    root = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
    ET.SubElement(root, "PRODUCT", Name="Crate", Version="1.0", Company="spotify-dl")
    collection = ET.SubElement(root, "COLLECTION", Entries=str(len(keyed)))
    for key, t in keyed:
        total = _duration_secs(t)
        ET.SubElement(collection, "TRACK",
                      TrackID=key,
                      Name=t.get("title") or "",
                      Artist=t.get("artist") or "",
                      AverageBpm=_fmt_bpm(t.get("bpm")),
                      Tonality=t.get("key_name") or "",
                      TotalTime=str(total if total >= 0 else 0),
                      Location=_location_url(_track_path(t)))

    playlists = ET.SubElement(root, "PLAYLISTS")
    rootnode = ET.SubElement(playlists, "NODE", Type="0", Name="ROOT", Count="1")
    plnode = ET.SubElement(rootnode, "NODE", Name=playlist_name, Type="1",
                           KeyType="0", Entries=str(len(keyed)))
    for key, _ in keyed:
        ET.SubElement(plnode, "TRACK", Key=key)

    xml = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml
