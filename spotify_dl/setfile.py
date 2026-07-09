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

import itertools
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


def _one_line(s):
    """An EXTINF label occupies exactly one line. A tag carrying an interior
    newline would otherwise inject extra m3u8 directives and path entries."""
    return re.sub(r"\s*[\r\n]+\s*", " ", (s or "")).strip()


def _m3u8_text(tracks):
    lines = ["#EXTM3U"]
    for t in tracks:
        path = _track_path(t)
        if not _is_file_path(path):
            continue
        artist = _one_line(t.get("artist"))
        title = _one_line(t.get("title"))
        label = f"{artist} - {title}" if artist else title
        lines.append(f"#EXTINF:{_duration_secs(t)},{label}")
        lines.append(path)
    return "\n".join(lines) + "\n"


def _claim_stem(d, stem, name):
    """Pick a stem that won't clobber a different set. Re-saving the same set
    (matching sidecar name) reuses its files; anything else uniquifies, because
    distinct names can sanitize to the same stem ("My Set!" and "My Set?" both
    become "My Set_") and losing a set to a punctuation collision is not ok."""
    for n in itertools.count(1):
        candidate = stem if n == 1 else f"{stem} ({n})"
        m3u8_path = d / f"{candidate}.m3u8"
        json_path = d / f"{candidate}.json"
        if not m3u8_path.exists() and not json_path.exists():
            return candidate
        try:
            if json.loads(json_path.read_text(encoding="utf-8")).get("name") == name:
                return candidate  # same set, overwrite in place
        except (OSError, ValueError):
            pass  # unreadable or absent sidecar — treat as someone else's file


def _claim_new_stem(d, base_stem, skip=None):
    """A stem used by no set other than `skip` (a Path allowed to be reused, e.g.
    a rename in place). Unlike _claim_stem this NEVER overwrites a same-named set,
    so rename/duplicate can't destroy a distinct existing set that shares a name."""
    for n in itertools.count(1):
        candidate = base_stem if n == 1 else f"{base_stem} ({n})"
        m3u8_path = d / f"{candidate}.m3u8"
        json_path = d / f"{candidate}.json"
        if m3u8_path == skip:
            return candidate
        if not m3u8_path.exists() and not json_path.exists():
            return candidate


def save(dir, name, tracks):
    """Write <name>.m3u8 (the portable artifact) and <name>.json (Crate state)
    into `dir`, in set order. Returns the m3u8 Path."""
    d = Path(dir)
    d.mkdir(parents=True, exist_ok=True)
    stem = _claim_stem(d, _safe_name(name), name)
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
        "rekordbox_playlist_name": None,
    }
    json_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return m3u8_path


def _paths_for(dir, stem):
    """The (m3u8, json) Paths for a set addressed by its filename stem, guaranteed
    to sit directly inside `dir`. `stem` is re-sanitized because it arrives back
    as a URL path segment: a hostile '../../etc/passwd' must never escape."""
    d = Path(dir)
    safe = _safe_name(stem)
    m3u8_path = d / f"{safe}.m3u8"
    json_path = d / f"{safe}.json"
    root = d.resolve()
    if m3u8_path.resolve().parent != root or json_path.resolve().parent != root:
        raise ValueError("unsafe set name")
    return m3u8_path, json_path


def find(dir, stem):
    """The m3u8 Path for a set addressed by its stem, or None if there is none.
    The stem is the stable on-disk id that list_sets reports."""
    try:
        m3u8_path, _ = _paths_for(dir, stem)
    except ValueError:
        return None
    return m3u8_path if m3u8_path.is_file() else None


def set_mapping(dir, stem, playlist_id, playlist_name=None):
    """Record which rekordbox playlist an export of this set produced. Re-export
    overwrites the mapping (it made a NEW playlist); the previous playlist's rows
    are never touched here."""
    try:
        _, json_path = _paths_for(dir, stem)
    except ValueError:
        return None
    if not json_path.is_file():
        return None
    data = json.loads(json_path.read_text(encoding="utf-8"))
    data["rekordbox_playlist_id"] = playlist_id
    data["rekordbox_playlist_name"] = playlist_name
    json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return json_path


def rename(dir, stem, new_name):
    """Rename a set: display name and on-disk stem both change; any export mapping
    is preserved (renaming the Crate set doesn't alter what was exported).
    Uniquifies against a DIFFERENT existing set — never clobbers it. None if the
    set does not exist."""
    d = Path(dir)
    old_m3u8 = find(d, stem)
    if old_m3u8 is None:
        return None
    _, old_json = _paths_for(d, stem)
    data = load(old_m3u8)
    data["name"] = new_name
    new_stem = _claim_new_stem(d, _safe_name(new_name), skip=old_m3u8)
    new_m3u8, new_json = _paths_for(d, new_stem)
    new_m3u8.write_text(old_m3u8.read_text(encoding="utf-8"), encoding="utf-8")
    new_json.write_text(json.dumps(data, indent=2), encoding="utf-8")
    if new_m3u8 != old_m3u8:
        old_m3u8.unlink(missing_ok=True)
        old_json.unlink(missing_ok=True)
    return new_m3u8


def duplicate(dir, stem, new_name=None):
    """Copy a set to a NEW, uniquified set. The copy is unexported — its mapping
    resets to None so it isn't shown as tied to a playlist the original produced.
    None if the source set does not exist."""
    d = Path(dir)
    src_m3u8 = find(d, stem)
    if src_m3u8 is None:
        return None
    data = load(src_m3u8)
    base_name = new_name or f"{data.get('name') or stem} copy"
    new_stem = _claim_new_stem(d, _safe_name(base_name))
    new_m3u8, new_json = _paths_for(d, new_stem)
    sidecar = {
        "name": base_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tracks": data.get("tracks", []),
        "rekordbox_playlist_id": None,
        "rekordbox_playlist_name": None,
    }
    new_m3u8.write_text(src_m3u8.read_text(encoding="utf-8"), encoding="utf-8")
    new_json.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return new_m3u8


def delete(dir, stem):
    """Delete ONLY this Crate set's own files (.m3u8 + .json). Never a rekordbox
    playlist, never an audio file. Returns whether anything was removed."""
    try:
        m3u8_path, json_path = _paths_for(dir, stem)
    except ValueError:
        return False
    existed = m3u8_path.is_file() or json_path.is_file()
    m3u8_path.unlink(missing_ok=True)
    json_path.unlink(missing_ok=True)
    return existed


def resolve_entries(entries, by_id, by_path):
    """Resolve stored {id, path} entries against the live collection, content id
    FIRST then absolute path. Returns (tracks, path_resolved, unresolved):

    - tracks: the resolved live records, in order (an id change is followed);
    - path_resolved: entries that matched only by path — the content id changed
      (a rebuilt rekordbox library) — each carrying the new resolved id;
    - unresolved: entries that matched neither, reported so a short set is never
      presented silently.

    A track whose FILE is missing still resolves: resolution is against the DB
    records, not the disk, so a moved file stays in the set."""
    tracks, path_resolved, unresolved = [], [], []
    for e in entries:
        eid = e.get("id")
        path = e.get("path") or ""
        if eid is not None and eid in by_id:
            tracks.append(by_id[eid])
        elif path and path in by_path:
            rec = by_path[path]
            tracks.append(rec)
            path_resolved.append({"id": eid, "path": path, "resolved_id": rec["id"]})
        else:
            unresolved.append({"id": eid, "path": path})
    return tracks, path_resolved, unresolved


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
        pid = data.get("rekordbox_playlist_id")
        out.append({"name": data.get("name") or m3u8.stem,
                    "stem": m3u8.stem,
                    "path": str(m3u8),
                    "created_at": data.get("created_at"),
                    "track_count": len(data.get("tracks", [])),
                    "rekordbox_playlist_id": pid,
                    "rekordbox_playlist_name": data.get("rekordbox_playlist_name"),
                    "exported": pid is not None})
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


def to_rekordbox_xml(tracks, playlist_name, cues=None):
    """A DJ_PLAYLISTS document rekordbox can import: a COLLECTION of TRACK nodes
    plus a PLAYLISTS node referencing them, in order. Streaming-only entries
    (no filesystem path) are omitted. ElementTree escapes all values.

    `cues` (optional) is `parse_cues(...)["cues"]`: a mapping of
    `{track_id: [{"num", "name", "start", "end"}]}`. Each cue becomes a
    POSITION_MARK on its TRACK — a point (Type="0") or, when `end` is set, a
    loop (Type="4", carrying End). Absent `cues`, output is byte-identical to
    the cue-free document."""
    included = [t for t in tracks if _is_file_path(_track_path(t))]
    # A stable key per track, shared by the COLLECTION TrackID and the playlist
    # TRACK Key so the reference resolves.
    keyed = [(str(t.get("id") or i), t) for i, t in enumerate(included, 1)]

    root = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
    ET.SubElement(root, "PRODUCT", Name="Crate", Version="1.0", Company="spotify-dl")
    collection = ET.SubElement(root, "COLLECTION", Entries=str(len(keyed)))
    for key, t in keyed:
        total = _duration_secs(t)
        tr = ET.SubElement(collection, "TRACK",
                           TrackID=key,
                           Name=t.get("title") or "",
                           Artist=t.get("artist") or "",
                           AverageBpm=_fmt_bpm(t.get("bpm")),
                           Tonality=t.get("key_name") or "",
                           TotalTime=str(total if total >= 0 else 0),
                           Location=_location_url(_track_path(t)))
        for c in (cues or {}).get(str(t.get("id")), []):
            attrs = {"Name": c.get("name") or "",
                     "Type": "4" if c.get("end") is not None else "0",
                     "Start": f"{c['start']:.3f}",
                     "Num": str(c["num"])}
            if c.get("end") is not None:
                attrs["End"] = f"{c['end']:.3f}"
            ET.SubElement(tr, "POSITION_MARK", **attrs)

    playlists = ET.SubElement(root, "PLAYLISTS")
    rootnode = ET.SubElement(playlists, "NODE", Type="0", Name="ROOT", Count="1")
    plnode = ET.SubElement(rootnode, "NODE", Name=playlist_name, Type="1",
                           KeyType="0", Entries=str(len(keyed)))
    for key, _ in keyed:
        ET.SubElement(plnode, "TRACK", Key=key)

    xml = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml
