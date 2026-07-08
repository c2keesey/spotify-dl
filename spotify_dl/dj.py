"""Pure DJ math: Camelot key mapping, transition compatibility, track energy.

No rekordbox dependency here — everything is unit-testable in isolation.
"""

import json
import re
import subprocess
from pathlib import Path

# rekordbox key name (both sharp and flat spellings) -> Camelot code.
# Minor keys are the A ring, major keys the B ring.
CAMELOT = {
    "Abm": "1A", "G#m": "1A", "B": "1B",
    "Ebm": "2A", "D#m": "2A", "F#": "2B", "Gb": "2B",
    "Bbm": "3A", "A#m": "3A", "Db": "3B", "C#": "3B",
    "Fm": "4A", "Ab": "4B", "G#": "4B",
    "Cm": "5A", "Eb": "5B", "D#": "5B",
    "Gm": "6A", "Bb": "6B", "A#": "6B",
    "Dm": "7A", "F": "7B",
    "Am": "8A", "C": "8B",
    "Em": "9A", "G": "9B",
    "Bm": "10A", "D": "10B",
    "F#m": "11A", "Gbm": "11A", "A": "11B",
    "Dbm": "12A", "C#m": "12A", "E": "12B",
}


def to_camelot(key_name):
    """Camelot code for a rekordbox key name, or None if unknown/missing."""
    if not key_name:
        return None
    return CAMELOT.get(key_name.strip())


def _camelot_parts(code):
    return int(code[:-1]), code[-1]


def harmonic_score(c1, c2):
    """0 = harmonic, 1 = workable, 2 = clash. Unknown keys score 1 (don't
    call a clash on a track rekordbox hasn't keyed)."""
    if not c1 or not c2:
        return 1
    if c1 == c2:
        return 0
    n1, r1 = _camelot_parts(c1)
    n2, r2 = _camelot_parts(c2)
    step = min(abs(n1 - n2), 12 - abs(n1 - n2))   # distance around the wheel
    if r1 == r2 and step == 1:                     # ±1 same ring
        return 0
    if n1 == n2:                                   # relative major/minor
        return 0
    if r1 == r2 and step == 2:                     # two steps: mixable with care
        return 1
    return 2


def bpm_delta(b1, b2):
    """Smallest relative tempo gap, allowing half/double-time matches."""
    if not b1 or not b2:
        return 0.0
    candidates = [(b1, b2), (b1 * 2, b2), (b1 / 2, b2)]
    return min(abs(x - y) / max(x, y) for x, y in candidates)


def rate_transition(a, b):
    """'good' | 'ok' | 'clash' for playing track b after track a."""
    h = harmonic_score(a.get("camelot"), b.get("camelot"))
    d = bpm_delta(a.get("bpm"), b.get("bpm"))
    if h == 2 or d > 0.12:
        return "clash"
    if h == 0 and d <= 0.06:
        return "good"
    return "ok"


# ---- energy (EBU R128 integrated loudness via ffmpeg) ----

ENERGY_CACHE = Path.home() / ".spotify_dl_energy.json"
LOUDNESS_RE = re.compile(r"I:\s*(-?[\d.]+)\s*LUFS")


def parse_loudness(ffmpeg_stderr):
    """Integrated LUFS from ffmpeg's ebur128 summary, or None."""
    matches = LOUDNESS_RE.findall(ffmpeg_stderr or "")
    return float(matches[-1]) if matches else None


def _load_energy_cache(cache_file):
    try:
        return json.loads(Path(cache_file).read_text())
    except (OSError, ValueError):
        return {}


def get_energy(path, cache_file=None):
    """Integrated loudness of an audio file, cached by path+mtime. Returns
    LUFS (typically -20..-5; higher = louder = more energy) or None."""
    cache_file = cache_file or ENERGY_CACHE
    p = Path(path)
    try:
        key = f"{p}:{p.stat().st_mtime_ns}"
    except OSError:
        return None
    cache = _load_energy_cache(cache_file)
    if key in cache:
        return cache[key]
    try:
        done = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", str(p),
             "-af", "ebur128", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    lufs = parse_loudness(done.stderr)
    if lufs is not None:
        cache[key] = lufs
        try:
            Path(cache_file).write_text(json.dumps(cache))
        except OSError:
            pass
    return lufs
