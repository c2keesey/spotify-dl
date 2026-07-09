"""Flightcase bundles: a .crate zip of byte-identical audio + precomputed
waveform peaks + a manifest, and the validator for the cues.json that comes
back. Nothing here reads or writes master.db — callers hand in already
resolved track records. Audio enters the zip via ZipFile.write() on the
source path: never re-encoded, never re-tagged.
"""

import json
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# ffmpeg decodes to mono u8 PCM at this rate; buckets of DECODE_RATE // rate
# samples reduce to one absolute-peak byte each. 8kHz keeps the pipe small
# while leaving 40 samples per bucket at the default rate.
DECODE_RATE = 8000


def peaks(path, rate=200):
    """Waveform envelope: one uint8 per 1/rate second, 0..255. Decodes via
    ffmpeg subprocess (timeout, no lock — same discipline as dj.measure_energy)."""
    done = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-v", "error",
         "-i", str(path), "-ac", "1", "-ar", str(DECODE_RATE),
         "-f", "u8", "-"],
        capture_output=True, timeout=120,
    )
    if done.returncode != 0 or not done.stdout:
        raise ValueError(f"ffmpeg could not decode {path}: "
                         f"{done.stderr.decode(errors='replace')[:200]}")
    pcm = done.stdout
    per = max(1, DECODE_RATE // rate)
    out = bytearray()
    for i in range(0, len(pcm), per):
        bucket = pcm[i:i + per]
        peak = max(abs(b - 128) for b in bucket)
        out.append(min(255, peak * 2))
    return bytes(out)


def build(tracks, name, stem, out_dir, rate=200):
    """Write <stem>.crate into out_dir from resolved track records (in set
    order). Tracks whose file_state is not "present" are excluded and
    returned as `skipped`. Raises ValueError when nothing is present."""
    present = [t for t in tracks if t.get("file_state") == "present"]
    skipped = [t for t in tracks if t.get("file_state") != "present"]
    if not present:
        raise ValueError("no tracks with a present audio file to bundle")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{stem}.crate"

    # The manifest is fully computable from the track records before any audio
    # is written, so build it up front and emit it as the FIRST zip entry. The
    # importer's pass 1 scans only until it reaches manifest.json; a leading
    # manifest lets it stop after the file prefix instead of the whole bundle.
    entries = []  # (src, audio_name, peaks_name), in set order
    manifest = {
        "schema": 1, "set": stem, "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order": [str(t["id"]) for t in present],
        "tracks": [],
    }
    for t in present:
        tid = str(t["id"])
        src = Path(t["file_path"])
        audio_name = f"audio/{tid}{src.suffix.lower()}"
        peaks_name = f"peaks/{tid}.bin"
        entries.append((src, audio_name, peaks_name))
        manifest["tracks"].append({
            "id": tid, "title": t.get("title") or "",
            "artist": t.get("artist") or "",
            "bpm": t.get("bpm"), "key_name": t.get("key_name") or "",
            "camelot": t.get("camelot") or "",
            "genre": t.get("genre") or "",
            "duration": t.get("duration"),
            "audio": audio_name, "peaks": peaks_name, "peaks_rate": rate,
        })

    with zipfile.ZipFile(out, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2),
                   compress_type=zipfile.ZIP_DEFLATED)
        for src, audio_name, peaks_name in entries:
            # STORED: mp3/m4a don't compress and byte identity is the point.
            z.write(src, audio_name, compress_type=zipfile.ZIP_STORED)
            z.writestr(peaks_name, peaks(src, rate=rate),
                       compress_type=zipfile.ZIP_DEFLATED)
    return out, skipped


def parse_cues(data):
    """Validate a cues.json payload. Returns {set, name, order, cues} where
    cues maps track id -> list of {num, name, start, end}. Raises ValueError
    with a human-readable reason — never silently drops a cue."""
    if not isinstance(data, dict):
        raise ValueError("cues payload must be an object")
    if data.get("schema") != 1:
        raise ValueError(f"unsupported cues schema: {data.get('schema')!r}")
    tracks = data.get("tracks")
    if not isinstance(tracks, list):
        raise ValueError("cues payload needs a tracks list")
    order = data.get("order") or []
    if not isinstance(order, list) or not all(isinstance(i, str) for i in order):
        raise ValueError("order must be a list of track id strings")

    cues = {}
    for t in tracks:
        tid = t.get("id")
        if not isinstance(tid, str) or not tid:
            raise ValueError("every track needs a string id")
        seen = set()
        out = []
        for c in t.get("cues") or []:
            num = c.get("num")
            if not isinstance(num, int) or not 0 <= num <= 7:
                raise ValueError(f"track {tid}: slot out of range 0..7: {num!r}")
            if num in seen:
                raise ValueError(f"track {tid}: duplicate slot {num}")
            seen.add(num)
            start = c.get("start")
            if not isinstance(start, (int, float)) or start < 0:
                raise ValueError(f"track {tid}: bad start: {start!r}")
            end = c.get("end")
            if end is not None:
                if not isinstance(end, (int, float)) or end <= start:
                    raise ValueError(
                        f"track {tid} slot {num}: end must be > start")
            name = c.get("name")
            out.append({"num": num,
                        "name": name if isinstance(name, str) else "",
                        "start": float(start),
                        "end": float(end) if end is not None else None})
        cues[tid] = out
    return {"set": data.get("set") or "", "name": data.get("name") or "",
            "order": order, "cues": cues}
