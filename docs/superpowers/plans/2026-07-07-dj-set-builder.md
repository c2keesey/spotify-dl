# DJ Set Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "DJ Sets" tab to the spotify-dl web UI that auto-imports downloaded tracks into rekordbox (dedup-first, additive-only), reads rekordbox's BPM/key analysis, shows Camelot keys + energy, lets the user manually order a set with compatibility hints, and saves the set back to rekordbox as a NEW playlist.

**Architecture:** Two new modules — `spotify_dl/dj.py` (pure music math: Camelot mapping, transition compatibility, ffmpeg energy) and `spotify_dl/rekordbox.py` (pyrekordbox wrapper: read collection, dedup, guarded additive writes, backups). New `/api/dj/*` endpoints in `spotify_dl/web.py` delegate to those modules. New "DJ Sets" tab in `spotify_dl/static/index.html` (vanilla JS, same conventions as the rest of the file).

**Tech Stack:** Python 3.10+, FastAPI, pyrekordbox 0.4.x, mutagen (already a dep), ffmpeg (already a runtime dep), vanilla JS + inline SVG.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-dj-set-builder-design.md`. Read it before starting any task.
- **Writes to rekordbox are ONLY ever additive**: new collection entries, new playlists. Never modify or delete existing rows. Playlist name collisions are uniquified, never replaced.
- **Dedup check runs before every import**, always. Skipped duplicates are reported, never silently dropped.
- **Never write while rekordbox is running** — check `is_rekordbox_running()` and refuse.
- **Back up `master.db` before every write** (timestamped copy alongside it).
- **No auto-ordering** — set order is manual; the tool only rates adjacent pairs. Do not implement any suggest-order algorithm.
- Use `uv` for everything (`uv add`, `uv run pytest`). Python style matches existing modules (plain functions, minimal abstraction, lowercase_snake, terse docstrings).
- All new endpoint tests mock the rekordbox layer (monkeypatch module functions) — no test may write to the real `master.db`. Only the explicitly guarded read-only test touches the real DB, and it must skip when absent.
- rekordbox facts (validated live 2026-07-07): DB at `~/Library/Pioneer/rekordbox/master.db`; `pyrekordbox.Rekordbox6Database` opens it (works for rekordbox 6 and 7); `DjmdContent.BPM` is int ×100 (11988 → 119.88); key name is `content.Key.ScaleName` (e.g. `"Am"`, `"F"`, `"Gm"`); `content.Artist.Name`; `content.Length` is seconds; `pyrekordbox.utils.get_rekordbox_pid()` returns 0 when not running. Write API: `db.add_content(path, **column_kwargs)`, `db.create_playlist(name)`, `db.add_to_playlist(playlist, content_id, track_no=n)`, `db.commit()`.
- Commit after every task with a conventional message (`feat: …`, `test: …`). Branch: `dj-set-builder`.

---

### Task 1: Camelot key mapping (`dj.py`)

**Files:**
- Create: `spotify_dl/dj.py`
- Test: `tests/test_dj.py`

**Interfaces:**
- Produces: `dj.to_camelot(key_name: str | None) -> str | None` and the `dj.CAMELOT` dict. Used by Tasks 2, 5, 8.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dj.py
"""Tests for pure DJ math: Camelot mapping, compatibility, energy parsing."""

import pytest

from spotify_dl import dj


# ---- camelot ----

@pytest.mark.parametrize("key,code", [
    ("Abm", "1A"), ("G#m", "1A"), ("B", "1B"),
    ("Ebm", "2A"), ("D#m", "2A"), ("F#", "2B"), ("Gb", "2B"),
    ("Bbm", "3A"), ("A#m", "3A"), ("Db", "3B"), ("C#", "3B"),
    ("Fm", "4A"), ("Ab", "4B"), ("G#", "4B"),
    ("Cm", "5A"), ("Eb", "5B"), ("D#", "5B"),
    ("Gm", "6A"), ("Bb", "6B"), ("A#", "6B"),
    ("Dm", "7A"), ("F", "7B"),
    ("Am", "8A"), ("C", "8B"),
    ("Em", "9A"), ("G", "9B"),
    ("Bm", "10A"), ("D", "10B"),
    ("F#m", "11A"), ("Gbm", "11A"), ("A", "11B"),
    ("Dbm", "12A"), ("C#m", "12A"), ("E", "12B"),
])
def test_camelot_all_keys(key, code):
    assert dj.to_camelot(key) == code


def test_camelot_unknown_and_none():
    assert dj.to_camelot(None) is None
    assert dj.to_camelot("") is None
    assert dj.to_camelot("H#m") is None
    assert dj.to_camelot(" Am ") == "8A"      # tolerates whitespace
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_dj.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'spotify_dl.dj'` (or ImportError).

- [ ] **Step 3: Write the implementation**

```python
# spotify_dl/dj.py
"""Pure DJ math: Camelot key mapping, transition compatibility, track energy.

No rekordbox dependency here — everything is unit-testable in isolation.
"""

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_dj.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/dj.py tests/test_dj.py
git commit -m "feat: camelot key mapping for dj module"
```

---

### Task 2: Transition compatibility rating (`dj.py`)

**Files:**
- Modify: `spotify_dl/dj.py` (append)
- Test: `tests/test_dj.py` (append)

**Interfaces:**
- Consumes: `dj.to_camelot` / Camelot codes from Task 1.
- Produces: `dj.rate_transition(a: dict, b: dict) -> str` returning `"good" | "ok" | "clash"`, where `a`/`b` are dicts with keys `camelot` (str|None) and `bpm` (float|None). Also `dj.harmonic_score(c1, c2) -> int` (0/1/2) and `dj.bpm_delta(b1, b2) -> float`. Used by Task 9's `/api/dj/compatibility`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_dj.py`)

```python
# ---- compatibility ----

def T(camelot, bpm):
    return {"camelot": camelot, "bpm": bpm}


def test_same_key_same_bpm_is_good():
    assert dj.rate_transition(T("8A", 124), T("8A", 124)) == "good"


def test_adjacent_wheel_number_is_good():
    assert dj.rate_transition(T("8A", 124), T("9A", 126)) == "good"
    assert dj.rate_transition(T("8A", 124), T("7A", 122)) == "good"


def test_wheel_wraps_12_to_1():
    assert dj.rate_transition(T("12A", 124), T("1A", 124)) == "good"
    assert dj.rate_transition(T("1B", 124), T("12B", 124)) == "good"


def test_relative_major_minor_is_good():
    assert dj.rate_transition(T("8A", 124), T("8B", 124)) == "good"


def test_distant_key_is_clash():
    assert dj.rate_transition(T("8A", 124), T("3B", 124)) == "clash"


def test_big_bpm_jump_is_clash():
    assert dj.rate_transition(T("8A", 100), T("8A", 140)) == "clash"


def test_half_time_counts_as_compatible():
    assert dj.rate_transition(T("8A", 140), T("8A", 70)) == "good"


def test_two_steps_same_ring_is_ok():
    assert dj.rate_transition(T("8A", 124), T("10A", 124)) == "ok"


def test_compatible_key_moderate_bpm_gap_is_ok():
    # harmonic good but ~9% tempo jump -> ok, not good, not clash
    assert dj.rate_transition(T("8A", 120), T("8A", 131)) == "ok"


def test_unknown_key_never_clashes_on_key_alone():
    assert dj.rate_transition(T(None, 124), T("8A", 124)) == "ok"
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_dj.py -v`
Expected: Task-1 tests PASS; new tests FAIL with `AttributeError: ... 'rate_transition'`.

- [ ] **Step 3: Write the implementation** (append to `spotify_dl/dj.py`)

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_dj.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/dj.py tests/test_dj.py
git commit -m "feat: adjacent-pair transition compatibility rating"
```

---

### Task 3: Energy via ffmpeg loudness (`dj.py`)

**Files:**
- Modify: `spotify_dl/dj.py` (append)
- Test: `tests/test_dj.py` (append)

**Interfaces:**
- Produces: `dj.parse_loudness(ffmpeg_stderr: str) -> float | None` and `dj.get_energy(path: str, cache_file: Path | None = None) -> float | None` (integrated LUFS, cached by path+mtime in a JSON file, default `~/.spotify_dl_energy.json`). Used by Task 9's `/api/dj/energy`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_dj.py`)

```python
# ---- energy ----

FFMPEG_EBUR128_TAIL = """
[Parsed_ebur128_0 @ 0x158e0edc0] Summary:

  Integrated loudness:
    I:         -9.8 LUFS
    Threshold: -20.1 LUFS

  Loudness range:
    LRA:        5.5 LU
"""


def test_parse_loudness():
    assert dj.parse_loudness(FFMPEG_EBUR128_TAIL) == -9.8


def test_parse_loudness_missing():
    assert dj.parse_loudness("no summary here") is None


def test_get_energy_runs_ffmpeg_and_caches(tmp_path, monkeypatch):
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")
    cache = tmp_path / "energy.json"
    calls = []

    class FakeDone:
        stderr = FFMPEG_EBUR128_TAIL

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return FakeDone()

    monkeypatch.setattr(dj.subprocess, "run", fake_run)
    assert dj.get_energy(str(song), cache_file=cache) == -9.8
    assert dj.get_energy(str(song), cache_file=cache) == -9.8   # cached
    assert len(calls) == 1
    assert "ebur128" in " ".join(calls[0])


def test_get_energy_missing_file(tmp_path):
    assert dj.get_energy(str(tmp_path / "gone.mp3"), cache_file=tmp_path / "c.json") is None
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_dj.py -v`
Expected: new tests FAIL (`parse_loudness` undefined).

- [ ] **Step 3: Write the implementation** (append to `spotify_dl/dj.py`; add these imports at the top of the file)

```python
import json
import re
import subprocess
from pathlib import Path
```

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_dj.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/dj.py tests/test_dj.py
git commit -m "feat: track energy via ffmpeg ebur128 loudness, cached"
```

---

### Task 4: Dedup logic — normalization, tags, duplicate detection (`rekordbox.py`)

**Files:**
- Create: `spotify_dl/rekordbox.py`
- Test: `tests/test_rekordbox.py`

**Interfaces:**
- Consumes: nothing from other tasks (mutagen is already a project dep).
- Produces (all used by Tasks 5–7):
  - `rekordbox.norm_title(s: str) -> str`, `rekordbox.norm_artist(s: str) -> str`
  - `rekordbox.file_tags(path: str) -> tuple[str, str, float | None]` — (artist, title, duration_seconds) from ID3, best-effort
  - `rekordbox.find_duplicates(paths: list[str], existing: list[dict]) -> tuple[list[str], list[dict]]` — `(new_paths, dupes)`; each dupe is `{"path": str, "reason": str}`; `existing` records have keys `file_path`, `artist`, `title`, `duration`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_rekordbox.py
"""Tests for the rekordbox layer. Pure logic (dedup, normalization) tests run
everywhere; anything touching the live DB is guarded and read-only."""

import pytest

from spotify_dl import rekordbox as rb


# ---- normalization ----

def test_norm_title_strips_feat_and_noise():
    assert rb.norm_title("Intimidated (feat. H.E.R.)") == "intimidated"
    assert rb.norm_title("Yesterday [2009 Remaster]") == "yesterday"
    assert rb.norm_title("  Slow  Til I Die ") == "slow til i die"


def test_norm_title_keeps_remix_and_vip():
    # A remix/VIP/edit is a DIFFERENT track — must not be stripped.
    assert "remix" in rb.norm_title("Outerspace (Skrillex Remix)")
    assert "vip" in rb.norm_title("Differentiate (VIP)")


def test_norm_title_does_not_eat_ft_inside_words():
    # 'ft' must only match as a word ("feat"/"ft."), never mid-word.
    assert rb.norm_title("Left Behind") == "left behind"
    assert rb.norm_title("Soft Landing") == "soft landing"


def test_norm_artist():
    assert rb.norm_artist("KAYTRANADA") == "kaytranada"
    assert rb.norm_artist(None) == ""


# ---- dedup ----

def EX(path="/lib/a.mp3", artist="Artist", title="Song", duration=200.0):
    return {"file_path": path, "artist": artist, "title": title, "duration": duration}


def test_exact_path_is_duplicate():
    new, dupes = rb.find_duplicates(["/lib/a.mp3"], [EX(path="/lib/a.mp3")])
    assert new == []
    assert dupes[0]["path"] == "/lib/a.mp3"
    assert "same file" in dupes[0]["reason"]


def test_same_song_different_file_is_duplicate(monkeypatch):
    monkeypatch.setattr(rb, "file_tags", lambda p: ("Artist", "Song (feat. Guest)", 201.0))
    new, dupes = rb.find_duplicates(["/downloads/song.mp3"], [EX()])
    assert new == []
    assert "Song" in dupes[0]["reason"]


def test_different_song_same_title_word_is_not_merged(monkeypatch):
    monkeypatch.setattr(rb, "file_tags", lambda p: ("Artist", "Song (Club Remix)", 200.0))
    new, dupes = rb.find_duplicates(["/downloads/x.mp3"], [EX()])
    assert new == ["/downloads/x.mp3"] and dupes == []


def test_duration_mismatch_is_not_merged(monkeypatch):
    monkeypatch.setattr(rb, "file_tags", lambda p: ("Artist", "Song", 250.0))
    new, dupes = rb.find_duplicates(["/downloads/x.mp3"], [EX(duration=200.0)])
    assert new == ["/downloads/x.mp3"] and dupes == []


def test_partial_artist_match_still_duplicate(monkeypatch):
    # rekordbox often stores "A, B" for collabs while the tag says just "A"
    monkeypatch.setattr(rb, "file_tags", lambda p: ("KAYTRANADA", "Intimidated", 207.0))
    new, dupes = rb.find_duplicates(
        ["/d/x.mp3"], [EX(artist="KAYTRANADA, H.E.R.", title="Intimidated", duration=207.0)])
    assert new == [] and len(dupes) == 1


def test_missing_duration_matches_on_name_alone(monkeypatch):
    monkeypatch.setattr(rb, "file_tags", lambda p: ("Artist", "Song", None))
    new, dupes = rb.find_duplicates(["/d/x.mp3"], [EX(duration=None)])
    assert new == [] and len(dupes) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```python
# spotify_dl/rekordbox.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/rekordbox.py tests/test_rekordbox.py
git commit -m "feat: dedup detection for rekordbox imports"
```

---

### Task 5: rekordbox read layer — collection, running detection, backup

**Files:**
- Modify: `spotify_dl/rekordbox.py` (append)
- Modify: `pyproject.toml` (via `uv add pyrekordbox`)
- Test: `tests/test_rekordbox.py` (append)

**Interfaces:**
- Consumes: `dj.to_camelot` (Task 1), `norm_*` helpers (Task 4).
- Produces (used by Tasks 6–9):
  - `rekordbox.is_rekordbox_running() -> bool`
  - `rekordbox.open_db()` — returns a `Rekordbox6Database` (lazy import inside)
  - `rekordbox.load_tracks() -> list[dict]` — normalized records: `{id, title, artist, bpm, key_name, camelot, file_path, duration, status, playlists}` with `status` in `{"analyzed","pending"}`; sampler content (path contains `/Sampler/`) excluded
  - `rekordbox.backup_master_db() -> Path`

- [ ] **Step 1: Add the dependency**

Run: `uv add pyrekordbox`
Expected: `pyrekordbox` added to `[project.dependencies]` in pyproject.toml, lockfile updated.

- [ ] **Step 2: Write the failing tests** (append to `tests/test_rekordbox.py`)

```python
# ---- read layer (record shaping is pure; live read is guarded) ----

from pathlib import Path


class FakeKey:
    def __init__(self, name):
        self.ScaleName = name


class FakeArtist:
    def __init__(self, name):
        self.Name = name


class FakeContent:
    def __init__(self, id=1, title="Song", artist="Artist", bpm=12400,
                 key="Am", path="/lib/a.mp3", length=200):
        self.ID = id
        self.Title = title
        self.Artist = FakeArtist(artist) if artist else None
        self.BPM = bpm
        self.Key = FakeKey(key) if key else None
        self.FolderPath = path
        self.Length = length


def test_record_analyzed_track():
    r = rb._record(FakeContent())
    assert r == {
        "id": "1", "title": "Song", "artist": "Artist", "bpm": 124.0,
        "key_name": "Am", "camelot": "8A", "file_path": "/lib/a.mp3",
        "duration": 200, "status": "analyzed",
    }


def test_record_pending_when_unanalyzed():
    r = rb._record(FakeContent(bpm=0, key=None))
    assert r["status"] == "pending"
    assert r["bpm"] is None and r["camelot"] is None


def test_record_falls_back_to_filename():
    r = rb._record(FakeContent(title=None, artist=None, path="/lib/Cool Track.mp3"))
    assert r["title"] == "Cool Track" and r["artist"] == ""


def test_backup_master_db(tmp_path, monkeypatch):
    src = tmp_path / "master.db"
    src.write_bytes(b"db-bytes")
    monkeypatch.setattr(rb, "MASTER_DB", src)
    dest = rb.backup_master_db()
    assert dest.exists() and dest.read_bytes() == b"db-bytes"
    assert dest.name.startswith("master.backup.spotify-dl.")
    assert dest.parent == src.parent


LIVE_DB = Path.home() / "Library/Pioneer/rekordbox/master.db"


@pytest.mark.skipif(not LIVE_DB.exists(), reason="no rekordbox db on this machine")
def test_live_read_collection():
    tracks = rb.load_tracks()
    assert len(tracks) > 0
    analyzed = [t for t in tracks if t["status"] == "analyzed"]
    assert analyzed, "expected at least one analyzed track"
    t = analyzed[0]
    assert t["bpm"] and t["camelot"] and t["file_path"]
    assert not any("/Sampler/" in t["file_path"] for t in tracks)
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: new tests FAIL (`rb._record` missing).

- [ ] **Step 4: Write the implementation** (append to `spotify_dl/rekordbox.py`)

```python
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
```

- [ ] **Step 5: Run tests to verify they pass** (rekordbox may be open — reads still work)

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: all PASS, including `test_live_read_collection` on this machine (~1,465 tracks exist).

- [ ] **Step 6: Commit**

```bash
git add spotify_dl/rekordbox.py tests/test_rekordbox.py pyproject.toml uv.lock
git commit -m "feat: rekordbox collection read layer with pyrekordbox"
```

---

### Task 6: Guarded additive import (`rekordbox.py`)

**Files:**
- Modify: `spotify_dl/rekordbox.py` (append)
- Test: `tests/test_rekordbox.py` (append)

**Interfaces:**
- Consumes: `find_duplicates`, `file_tags`, `load_tracks`, `backup_master_db`, `is_rekordbox_running`, `open_db` (Tasks 4–5).
- Produces: `rekordbox.RekordboxRunning(RuntimeError)` and `rekordbox.import_files(paths: list[str]) -> dict` returning `{"imported": [paths], "skipped_duplicates": [{"path","reason"}]}`. Used by Task 9.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_rekordbox.py`)

```python
# ---- guarded import (db layer stubbed; never touches the real DB) ----

class FakeDB:
    def __init__(self):
        self.added = []
        self.committed = False
        self.closed = False

    def add_content(self, path, **kw):
        self.added.append((str(path), kw))

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


@pytest.fixture
def stub_writes(monkeypatch):
    fake = FakeDB()
    backups = []
    monkeypatch.setattr(rb, "is_rekordbox_running", lambda: False)
    monkeypatch.setattr(rb, "open_db", lambda: fake)
    monkeypatch.setattr(rb, "load_tracks", lambda: [EX()])
    monkeypatch.setattr(rb, "backup_master_db", lambda: backups.append(1) or Path("/tmp/b.db"))
    monkeypatch.setattr(rb, "file_tags", lambda p: ("New Artist", "New Song", 180.0))
    return fake, backups


def test_import_refuses_while_rekordbox_running(monkeypatch):
    monkeypatch.setattr(rb, "is_rekordbox_running", lambda: True)
    with pytest.raises(rb.RekordboxRunning):
        rb.import_files(["/d/x.mp3"])


def test_import_dedups_then_adds(stub_writes, monkeypatch):
    fake, backups = stub_writes
    result = rb.import_files(["/lib/a.mp3", "/d/new.mp3"])
    assert result["imported"] == ["/d/new.mp3"]
    assert len(result["skipped_duplicates"]) == 1
    assert backups == [1]                      # backed up before writing
    assert fake.added[0][0] == "/d/new.mp3"
    assert fake.added[0][1].get("Title") == "New Song"
    assert fake.committed and fake.closed


def test_import_all_duplicates_writes_nothing(stub_writes, monkeypatch):
    fake, backups = stub_writes
    result = rb.import_files(["/lib/a.mp3"])
    assert result["imported"] == []
    assert backups == []                       # no write -> no backup needed
    assert fake.added == []
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: new tests FAIL (`RekordboxRunning` missing).

- [ ] **Step 3: Write the implementation** (append to `spotify_dl/rekordbox.py`)

```python
class RekordboxRunning(RuntimeError):
    """Raised when a write is attempted while rekordbox holds the DB lock."""


def import_files(paths):
    """Additive-only import: dedup FIRST, then add only genuinely new tracks.
    Never modifies existing rows. Returns {imported, skipped_duplicates}."""
    if is_rekordbox_running():
        raise RekordboxRunning("close rekordbox first")
    existing = load_tracks()
    new, dupes = find_duplicates(paths, existing)
    if new:
        backup_master_db()
        db = open_db()
        try:
            for p in new:
                _artist, title, _dur = file_tags(p)
                db.add_content(p, Title=title)
            db.commit()
        finally:
            db.close()
    return {"imported": new, "skipped_duplicates": dupes}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/rekordbox.py tests/test_rekordbox.py
git commit -m "feat: guarded dedup-first additive import into rekordbox"
```

---

### Task 7: Export set as a NEW rekordbox playlist (`rekordbox.py`)

**Files:**
- Modify: `spotify_dl/rekordbox.py` (append)
- Test: `tests/test_rekordbox.py` (append)

**Interfaces:**
- Consumes: guards from Tasks 5–6.
- Produces: `rekordbox.export_playlist(name: str, track_ids: list[str]) -> dict` returning `{"playlist": final_name}`. Always creates a NEW playlist; collides → `"Name (2)"`, `"Name (3)"`, … Used by Task 9.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_rekordbox.py`)

```python
# ---- export (always a NEW playlist) ----

class FakePlaylist:
    def __init__(self, name):
        self.Name = name


class FakeExportDB(FakeDB):
    def __init__(self, existing_names=()):
        super().__init__()
        self.existing = [FakePlaylist(n) for n in existing_names]
        self.created = []
        self.playlist_adds = []

    def get_playlist(self):
        return self.existing

    def create_playlist(self, name):
        pl = FakePlaylist(name)
        self.created.append(name)
        return pl

    def add_to_playlist(self, playlist, content, track_no=None):
        self.playlist_adds.append((playlist.Name, content, track_no))


@pytest.fixture
def stub_export(monkeypatch):
    def make(existing_names=()):
        fake = FakeExportDB(existing_names)
        monkeypatch.setattr(rb, "is_rekordbox_running", lambda: False)
        monkeypatch.setattr(rb, "open_db", lambda: fake)
        monkeypatch.setattr(rb, "backup_master_db", lambda: Path("/tmp/b.db"))
        return fake
    return make


def test_export_creates_new_playlist_in_order(stub_export):
    fake = stub_export()
    result = rb.export_playlist("Friday Set", ["10", "20", "30"])
    assert result == {"playlist": "Friday Set"}
    assert fake.created == ["Friday Set"]
    assert fake.playlist_adds == [
        ("Friday Set", "10", 1), ("Friday Set", "20", 2), ("Friday Set", "30", 3)]
    assert fake.committed


def test_export_uniquifies_name_never_touches_existing(stub_export):
    fake = stub_export(existing_names=["Friday Set", "Friday Set (2)"])
    result = rb.export_playlist("Friday Set", ["10"])
    assert result == {"playlist": "Friday Set (3)"}
    assert fake.created == ["Friday Set (3)"]


def test_export_refuses_while_running(monkeypatch):
    monkeypatch.setattr(rb, "is_rekordbox_running", lambda: True)
    with pytest.raises(rb.RekordboxRunning):
        rb.export_playlist("X", ["1"])


def test_export_rejects_empty(stub_export):
    with pytest.raises(ValueError):
        rb.export_playlist("X", [])
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: new tests FAIL (`export_playlist` missing).

- [ ] **Step 3: Write the implementation** (append to `spotify_dl/rekordbox.py`)

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_rekordbox.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/rekordbox.py tests/test_rekordbox.py
git commit -m "feat: export set as new rekordbox playlist with name uniquify"
```

---

### Task 8: API — `/api/dj/status` and `/api/dj/tracks`

**Files:**
- Modify: `spotify_dl/web.py` (add a `# ---- dj ----` section before the `@app.get("/")` route)
- Test: `tests/test_web.py` (append)

**Interfaces:**
- Consumes: `rekordbox.load_tracks`, `rekordbox.is_rekordbox_running` (Task 5).
- Produces (used by the frontend, Tasks 10–13):
  - `GET /api/dj/status?path=<outdir>` → `{"running": bool, "can_write": bool, "analyzed": int, "pending": int, "not_imported": int}` (`not_imported` = mp3s under `path` whose exact path is not in the collection; 0 when path empty)
  - `GET /api/dj/tracks?bpm_min=&bpm_max=&camelot=&q=` → `{"tracks": [record, ...]}`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_web.py`)

```python
# ---- dj: status & tracks (rekordbox layer stubbed) ----

def DJTRACK(**kw):
    base = {"id": "1", "title": "Song", "artist": "Artist", "bpm": 124.0,
            "key_name": "Am", "camelot": "8A", "file_path": "/lib/a.mp3",
            "duration": 200, "status": "analyzed", "playlists": []}
    base.update(kw)
    return base


def test_dj_status(client, monkeypatch, tmp_path):
    (tmp_path / "new.mp3").write_text("x")
    (tmp_path / "old.mp3").write_text("x")
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: True)
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(file_path=str(tmp_path / "old.mp3")),
        DJTRACK(id="2", status="pending", bpm=None, camelot=None),
    ])
    d = client.get("/api/dj/status", params={"path": str(tmp_path)}).json()
    assert d == {"running": True, "can_write": False,
                 "analyzed": 1, "pending": 1, "not_imported": 1}


def test_dj_tracks_filters(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(),
        DJTRACK(id="2", title="Fast One", bpm=150.0, camelot="9A"),
        DJTRACK(id="3", title="Other", artist="Someone", bpm=124.0, camelot="8B"),
    ])
    all_ = client.get("/api/dj/tracks").json()["tracks"]
    assert len(all_) == 3
    hits = client.get("/api/dj/tracks", params={"bpm_min": 140}).json()["tracks"]
    assert [t["id"] for t in hits] == ["2"]
    hits = client.get("/api/dj/tracks", params={"camelot": "8B"}).json()["tracks"]
    assert [t["id"] for t in hits] == ["3"]
    hits = client.get("/api/dj/tracks", params={"q": "someone"}).json()["tracks"]
    assert [t["id"] for t in hits] == ["3"]


def test_dj_tracks_db_error_is_503(client, monkeypatch):
    def boom():
        raise RuntimeError("no db")
    monkeypatch.setattr(web.rekordbox, "load_tracks", boom)
    assert client.get("/api/dj/tracks").status_code == 503
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_web.py -v -k dj`
Expected: FAIL — `web.rekordbox` attribute missing / 404s.

- [ ] **Step 3: Write the implementation** (in `spotify_dl/web.py`; add the import near the top with the other `spotify_dl` import, and the routes in a new section before `@app.get("/")`)

```python
from spotify_dl import dj, rekordbox
```

```python
# ---- dj / sets ----

def _dj_tracks_or_503():
    try:
        return rekordbox.load_tracks()
    except Exception as e:  # noqa: BLE001 - surface db problems as service-unavailable
        raise HTTPException(503, f"couldn't read rekordbox database: {e}")


@app.get("/api/dj/status")
def dj_status(path: str = ""):
    """Rekordbox state + analysis counts. Drives the tab's status banner."""
    tracks = _dj_tracks_or_503()
    running = rekordbox.is_rekordbox_running()
    not_imported = 0
    p = Path(path).expanduser() if path.strip() else None
    if p and p.is_dir():
        in_collection = {t["file_path"] for t in tracks}
        not_imported = sum(1 for f in p.rglob("*.mp3") if str(f) not in in_collection)
    return {
        "running": running,
        "can_write": not running,
        "analyzed": sum(1 for t in tracks if t["status"] == "analyzed"),
        "pending": sum(1 for t in tracks if t["status"] == "pending"),
        "not_imported": not_imported,
    }


@app.get("/api/dj/tracks")
def dj_tracks(bpm_min: float = 0, bpm_max: float = 0, camelot: str = "", q: str = ""):
    tracks = _dj_tracks_or_503()
    if bpm_min:
        tracks = [t for t in tracks if t["bpm"] and t["bpm"] >= bpm_min]
    if bpm_max:
        tracks = [t for t in tracks if t["bpm"] and t["bpm"] <= bpm_max]
    if camelot:
        tracks = [t for t in tracks if t["camelot"] == camelot.upper()]
    if q.strip():
        needle = q.strip().lower()
        tracks = [t for t in tracks
                  if needle in t["title"].lower() or needle in t["artist"].lower()]
    return {"tracks": tracks}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_web.py -v`
Expected: all PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/web.py tests/test_web.py
git commit -m "feat: dj status and tracks endpoints"
```

---

### Task 9: API — import, compatibility, energy, export + auto-import hook

**Files:**
- Modify: `spotify_dl/web.py` (append to the dj section; hook in `run_job`)
- Test: `tests/test_web.py` (append)

**Interfaces:**
- Consumes: `rekordbox.import_files` / `export_playlist` / `RekordboxRunning` (Tasks 6–7), `dj.rate_transition` / `get_energy` (Tasks 2–3).
- Produces:
  - `POST /api/dj/import` body `{"path": "<folder>"}` → `{"imported": [...], "skipped_duplicates": [...]}`; 409 with detail `"close rekordbox first"` when running
  - `POST /api/dj/compatibility` body `{"ids": [...]}` → `{"ratings": ["good"|"ok"|"clash", ...]}` (len = len(ids)-1)
  - `POST /api/dj/energy` body `{"ids": [...]}` → `{"energy": {id: lufs|null}}`
  - `POST /api/dj/export` body `{"name": str, "ids": [...]}` → `{"playlist": str}`; 409 when running
  - `run_job` auto-imports the job's output folder after a successful download when rekordbox is closed (best-effort, never fails the job)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_web.py`)

```python
# ---- dj: import / compatibility / energy / export ----

def test_dj_import_reports_both_lists(client, monkeypatch, tmp_path):
    (tmp_path / "a.mp3").write_text("x")
    monkeypatch.setattr(web.rekordbox, "import_files", lambda paths: {
        "imported": paths, "skipped_duplicates": []})
    d = client.post("/api/dj/import", json={"path": str(tmp_path)}).json()
    assert d["imported"] == [str(tmp_path / "a.mp3")]
    assert d["skipped_duplicates"] == []


def test_dj_import_409_when_rekordbox_running(client, monkeypatch, tmp_path):
    def refuse(paths):
        raise web.rekordbox.RekordboxRunning("close rekordbox first")
    monkeypatch.setattr(web.rekordbox, "import_files", refuse)
    r = client.post("/api/dj/import", json={"path": str(tmp_path)})
    assert r.status_code == 409
    assert "close rekordbox" in r.json()["detail"]


def test_dj_import_bad_path_is_400(client):
    assert client.post("/api/dj/import", json={"path": "/no/such/dir"}).status_code == 400


def test_dj_compatibility(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot="9A", bpm=126.0),
        DJTRACK(id="3", camelot="3B", bpm=90.0),
    ])
    d = client.post("/api/dj/compatibility", json={"ids": ["1", "2", "3"]}).json()
    assert d["ratings"] == ["good", "clash"]


def test_dj_energy(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", file_path="/lib/a.mp3")])
    monkeypatch.setattr(web.dj, "get_energy", lambda path: -9.8)
    d = client.post("/api/dj/energy", json={"ids": ["1", "999"]}).json()
    assert d["energy"] == {"1": -9.8, "999": None}


def test_dj_export(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "export_playlist",
                        lambda name, ids: {"playlist": name})
    d = client.post("/api/dj/export", json={"name": "Set", "ids": ["1"]}).json()
    assert d == {"playlist": "Set"}


def test_dj_export_409_when_running(client, monkeypatch):
    def refuse(name, ids):
        raise web.rekordbox.RekordboxRunning("close rekordbox first")
    monkeypatch.setattr(web.rekordbox, "export_playlist", refuse)
    assert client.post("/api/dj/export",
                       json={"name": "Set", "ids": ["1"]}).status_code == 409


def test_dj_export_empty_is_400(client):
    assert client.post("/api/dj/export", json={"name": "S", "ids": []}).status_code == 400
    assert client.post("/api/dj/export", json={"name": " ", "ids": ["1"]}).status_code == 400


def test_run_job_auto_imports_on_success(client, monkeypatch, tmp_path):
    lines = ["Total songs: 1\n", "[ExtractAudio] Destination: x.mp3\n"]
    monkeypatch.setattr(web.subprocess, "Popen", lambda *a, **k: FakeProc(lines, 0))
    imported = []
    monkeypatch.setattr(web, "auto_import", lambda output: imported.append(output))
    r = client.post("/api/download",
                    json={"urls": ["https://open.spotify.com/track/abc"],
                          "output": str(tmp_path)})
    job = web.jobs[r.json()["id"]]
    import time
    for _ in range(200):
        if job["status"] != "running":
            break
        time.sleep(0.01)
    assert imported == [str(tmp_path)]


def test_auto_import_skips_when_rekordbox_open(monkeypatch, tmp_path):
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: True)
    called = []
    monkeypatch.setattr(web.rekordbox, "import_files", lambda p: called.append(p))
    web.auto_import(str(tmp_path))
    assert called == []
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_web.py -v -k dj`
Expected: FAIL — routes missing.

- [ ] **Step 3: Write the implementation** (append to the dj section of `spotify_dl/web.py`)

```python
class DJImportRequest(BaseModel):
    path: str


class DJIdsRequest(BaseModel):
    ids: list[str]


class DJExportRequest(BaseModel):
    name: str
    ids: list[str]


@app.post("/api/dj/import")
def dj_import(req: DJImportRequest):
    """Dedup-first import of a folder's mp3s into the rekordbox collection.
    Called automatically after downloads; exposed for manual re-runs."""
    p = Path(req.path).expanduser()
    if not p.is_dir():
        raise HTTPException(400, "no such folder")
    files = sorted(str(f) for f in p.rglob("*.mp3"))
    try:
        return rekordbox.import_files(files)
    except rekordbox.RekordboxRunning:
        raise HTTPException(409, "close rekordbox first")


@app.post("/api/dj/compatibility")
def dj_compatibility(req: DJIdsRequest):
    """Passive adjacent-pair ratings for the user's own order. Never reorders."""
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    seq = [by_id.get(i, {}) for i in req.ids]
    return {"ratings": [dj.rate_transition(a, b) for a, b in zip(seq, seq[1:])]}


@app.post("/api/dj/energy")
def dj_energy(req: DJIdsRequest):
    """Integrated loudness for the given tracks (cached; computed on demand)."""
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    out = {}
    for i in req.ids:
        t = by_id.get(i)
        out[i] = dj.get_energy(t["file_path"]) if t else None
    return {"energy": out}


@app.post("/api/dj/export")
def dj_export(req: DJExportRequest):
    """Save the ordered set as a NEW rekordbox playlist (never overwrites)."""
    name = req.name.strip()
    if not name or not req.ids:
        raise HTTPException(400, "need a set name and at least one track")
    try:
        return rekordbox.export_playlist(name, req.ids)
    except rekordbox.RekordboxRunning:
        raise HTTPException(409, "close rekordbox first")


def auto_import(output):
    """Best-effort import of a finished download's folder. Skips quietly when
    rekordbox is open (the status banner surfaces the pending count instead)."""
    if rekordbox.is_rekordbox_running():
        return
    p = Path(output)
    if not p.is_dir():
        return
    rekordbox.import_files(sorted(str(f) for f in p.rglob("*.mp3")))
```

And in `run_job`, right after the existing `record_sources` block (keep it best-effort):

```python
        if job["status"] == "done":
            try:
                auto_import(job["output"])
            except Exception:  # noqa: BLE001 - rekordbox import must never fail a download
                pass
```

- [ ] **Step 4: Run the full test suite**

Run: `uv run pytest tests/test_web.py tests/test_dj.py tests/test_rekordbox.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/web.py tests/test_web.py
git commit -m "feat: dj import/compatibility/energy/export endpoints + auto-import"
```

---

### Task 10: Frontend — tab switcher, status banner, track browser

**Files:**
- Modify: `spotify_dl/static/index.html`

**Interfaces:**
- Consumes: `GET /api/dj/status`, `GET /api/dj/tracks`, `POST /api/dj/import` (Tasks 8–9).
- Produces: `switchTab(name)`, `refreshDJStatus()`, `refreshDJTracks()`, global `djTracks` (array of records) and `djSet` (array of track ids) used by Tasks 11–13. A `#tab-dl` wrapper around all existing sections and a `#tab-dj` sibling.

No unit tests (the project has no JS test rig); verification is by loading the page. Keep all existing behavior intact.

- [ ] **Step 1: Add the tab bar and DJ pane skeleton**

In `<body>`, wrap ALL existing content below `<header>` (the download card + Downloads/Library/Scheduled sections) in `<div id="tab-dl">`, and add after the header:

```html
  <nav class="tabs">
    <button class="tab on" data-tab="dl">Download</button>
    <button class="tab" data-tab="dj">DJ Sets</button>
  </nav>
```

And after `</div><!-- #tab-dl -->` add the DJ pane:

```html
  <div id="tab-dj" hidden>
    <div class="dj-banner card" id="dj-banner"></div>

    <section>
      <h2>Tracks <span class="h-act" id="dj-refresh">Refresh</span></h2>
      <div class="card">
        <div class="dj-filters">
          <input id="dj-q" placeholder="Search title or artist…" spellcheck="false">
          <input id="dj-bpm-min" type="number" placeholder="BPM ≥" min="0">
          <input id="dj-bpm-max" type="number" placeholder="BPM ≤" min="0">
          <select id="dj-camelot"><option value="">Any key</option></select>
        </div>
        <div class="dj-table-wrap"><table class="dj-table">
          <thead><tr><th></th><th>Title</th><th>Artist</th><th>BPM</th><th>Key</th><th></th></tr></thead>
          <tbody id="dj-rows"></tbody>
        </table></div>
      </div>
    </section>

    <section id="dj-set-section">
      <h2>Set</h2>
      <div class="card" id="dj-set-card">
        <div id="dj-set-summary" class="dj-set-summary"></div>
        <div id="dj-set-list"></div>
        <div class="bar">
          <input id="dj-set-name" placeholder="Set name…" spellcheck="false" class="dj-name-input">
          <button id="dj-save">Save to rekordbox</button>
        </div>
      </div>
      <div class="dj-viz">
        <div class="card dj-viz-card"><div id="dj-wheel"></div></div>
        <div class="card dj-viz-card"><div id="dj-energy"></div></div>
      </div>
    </section>
  </div>
```

- [ ] **Step 2: Add CSS** (append inside the existing `<style>`)

```css
  /* tabs */
  .tabs { display: flex; gap: 6px; margin-bottom: 22px; }
  .tab { background: transparent; border: 1px solid var(--border); color: var(--dim);
         font-weight: 500; padding: 7px 15px; border-radius: 20px; }
  .tab:hover { color: var(--text); background: var(--hover); filter: none; }
  .tab.on { color: var(--accent); border-color: var(--accent-dim); }
  body.dj-mode .wrap { max-width: 980px; }

  /* dj banner */
  .dj-banner { padding: 12px 18px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
  .dj-banner .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dj-banner .dot.open { background: var(--amber); }
  .dj-banner .dot.closed { background: var(--accent); }
  .dj-banner .hint { color: var(--dim); }
  .dj-banner .spacer { flex: 1; }

  /* filters + table */
  .dj-filters { display: flex; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .dj-filters input, .dj-filters select { background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font: 13px -apple-system, sans-serif; outline: none; }
  .dj-filters input:focus { border-color: var(--accent-dim); }
  #dj-q { flex: 1; }
  #dj-bpm-min, #dj-bpm-max { width: 74px; }
  .dj-table-wrap { max-height: 380px; overflow-y: auto; }
  .dj-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .dj-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--faint); padding: 8px 10px; position: sticky; top: 0; background: var(--panel); }
  .dj-table td { padding: 7px 10px; border-top: 1px solid var(--border); white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  .dj-table tr:hover td { background: var(--hover); }
  .dj-table .num { font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .dj-key { display: inline-block; min-width: 30px; text-align: center; font-size: 11px; font-weight: 600;
    border-radius: 20px; padding: 2px 7px; }
  .dj-pending { color: var(--faint); font-size: 11px; }
  .dj-add { background: transparent; border: 1px solid var(--border); color: var(--dim);
    font-size: 12px; padding: 3px 10px; border-radius: 7px; }
  .dj-add:hover { color: var(--accent); border-color: var(--accent-dim); background: transparent; filter: none; }
  .dj-add:disabled { opacity: 0.35; }
```

- [ ] **Step 3: Add the JS** (append inside the main `<script>`; before the boot IIFE)

```js
/* ==== DJ Sets tab ==== */
let djTracks = [];            // last-fetched track records
let djSet = [];               // ordered track ids in the working set
const CAMELOT_CODES = Array.from({length: 12}, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat();
$("dj-camelot").innerHTML = '<option value="">Any key</option>' +
  CAMELOT_CODES.map((c) => `<option>${c}</option>`).join("");

// Camelot color: hue around the wheel; A ring dimmer than B.
function camelotColor(code) {
  if (!code) return "var(--panel-2)";
  const n = parseInt(code), ring = code.endsWith("A");
  return `hsl(${(n - 1) * 30} 65% ${ring ? 38 : 52}% / 0.85)`;
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  $("tab-dl").hidden = name !== "dl";
  $("tab-dj").hidden = name !== "dj";
  document.body.classList.toggle("dj-mode", name === "dj");
  if (name === "dj") { refreshDJStatus(); refreshDJTracks(); }
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab");
  if (b) switchTab(b.dataset.tab);
});

async function refreshDJStatus() {
  const out = $("outdir").value.trim();
  let s;
  try {
    const r = await fetch("/api/dj/status?path=" + encodeURIComponent(out));
    if (!r.ok) throw new Error();
    s = await r.json();
  } catch {
    $("dj-banner").innerHTML = `<span class="hint">Couldn't read the rekordbox database.</span>`;
    return;
  }
  const dot = `<span class="dot ${s.running ? "open" : "closed"}"></span>`;
  const state = s.running ? "rekordbox is open" : "rekordbox is closed";
  let hint = "";
  if (s.pending) hint = s.running
    ? `${s.pending} track${s.pending === 1 ? "" : "s"} waiting for analysis — rekordbox analyzes them while open (needs Auto-Analysis on).`
    : `${s.pending} track${s.pending === 1 ? "" : "s"} not analyzed yet — open rekordbox to analyze.`;
  const importBtn = s.not_imported
    ? `<button id="dj-import" ${s.running ? "disabled title='Close rekordbox first'" : ""}>Import ${s.not_imported} new</button>`
    : "";
  $("dj-banner").innerHTML =
    `${dot}<span>${esc(state)}</span><span class="hint">${esc(hint)}</span><span class="spacer"></span>${importBtn}`;
  const btn = $("dj-import");
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Importing…";
    try {
      const r = await fetch("/api/dj/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: $("outdir").value.trim() }),
      });
      if (r.ok) {
        const d = await r.json();
        const skipped = d.skipped_duplicates.length;
        btn.textContent = `Imported ${d.imported.length}` + (skipped ? `, ${skipped} dup${skipped === 1 ? "" : "s"} skipped` : "");
        setTimeout(() => { refreshDJStatus(); refreshDJTracks(); }, 1500);
      } else {
        btn.textContent = (await r.json()).detail || "Failed";
      }
    } catch { btn.textContent = "Failed"; }
  };
}

async function refreshDJTracks() {
  const params = new URLSearchParams();
  if ($("dj-q").value.trim()) params.set("q", $("dj-q").value.trim());
  if ($("dj-bpm-min").value) params.set("bpm_min", $("dj-bpm-min").value);
  if ($("dj-bpm-max").value) params.set("bpm_max", $("dj-bpm-max").value);
  if ($("dj-camelot").value) params.set("camelot", $("dj-camelot").value);
  let d;
  try {
    const r = await fetch("/api/dj/tracks?" + params);
    if (!r.ok) throw new Error();
    d = await r.json();
  } catch {
    $("dj-rows").innerHTML = `<tr><td colspan="6" class="dj-pending">Couldn't read the rekordbox database.</td></tr>`;
    return;
  }
  djTracks = d.tracks;
  renderDJRows();
}

function renderDJRows() {
  const inSet = new Set(djSet);
  $("dj-rows").innerHTML = djTracks.map((t) => {
    const key = t.camelot
      ? `<span class="dj-key" style="background:${camelotColor(t.camelot)};color:#fff">${t.camelot}</span>`
      : `<span class="dj-pending">${t.status === "pending" ? "analyzing…" : "—"}</span>`;
    const add = t.status === "analyzed"
      ? `<button class="dj-add" data-id="${t.id}" ${inSet.has(t.id) ? "disabled" : ""}>${inSet.has(t.id) ? "Added" : "+ Set"}</button>`
      : "";
    return `<tr>
      <td>${t.status === "pending" ? "⏳" : ""}</td>
      <td title="${esc(t.title)}">${esc(t.title)}</td>
      <td title="${esc(t.artist)}">${esc(t.artist)}</td>
      <td class="num">${t.bpm ? t.bpm.toFixed(1) : ""}</td>
      <td>${key}</td>
      <td>${add}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="dj-pending">No tracks match.</td></tr>`;
}

let djFilterTimer = null;
["dj-q", "dj-bpm-min", "dj-bpm-max"].forEach((id) =>
  $(id).addEventListener("input", () => {
    clearTimeout(djFilterTimer);
    djFilterTimer = setTimeout(refreshDJTracks, 300);
  }));
$("dj-camelot").onchange = refreshDJTracks;
$("dj-refresh").onclick = () => { refreshDJStatus(); refreshDJTracks(); };
$("dj-rows").addEventListener("click", (e) => {
  const b = e.target.closest(".dj-add");
  if (b && !b.disabled) addToSet(b.dataset.id);
});
setInterval(() => { if (!$("tab-dj").hidden) refreshDJStatus(); }, 5000);
```

Note: `addToSet` is defined in Task 11 — until then add a temporary stub `function addToSet(id) {}` and REMOVE it in Task 11.

- [ ] **Step 4: Verify by hand**

Run: `uv run spotify-dl-ui` (or `SPOTIFY_DL_NO_BROWSER=1 uv run spotify-dl-ui &` and open `http://127.0.0.1:8765`).
Expected: Download tab unchanged and functional; DJ Sets tab shows banner (open/closed correct — rekordbox is open on this machine) and a populated, filterable track table with colored Camelot chips. Then run `uv run pytest tests/` — all pass.

- [ ] **Step 5: Commit**

```bash
git add spotify_dl/static/index.html
git commit -m "feat: dj tab with status banner and track browser"
```

---

### Task 11: Frontend — set builder (manual ordering + compatibility markers)

**Files:**
- Modify: `spotify_dl/static/index.html`

**Interfaces:**
- Consumes: `djTracks`, `djSet`, `renderDJRows`, `camelotColor` (Task 10); `POST /api/dj/compatibility`, `POST /api/dj/export` (Task 9).
- Produces: `addToSet(id)`, `renderSet()`, `djTrack(id)` used by Tasks 12–13. `renderSet()` must call `renderWheel()` and `renderEnergy()` if they exist (`typeof renderWheel === "function"`), so Tasks 12–13 plug in without edits here.

- [ ] **Step 1: Add CSS** (append inside `<style>`)

```css
  /* set builder */
  .dj-set-summary { padding: 10px 18px; font-size: 12px; color: var(--dim); border-bottom: 1px solid var(--border); }
  .dj-set-summary:empty { display: none; }
  #dj-set-list { min-height: 40px; }
  .dj-slot { display: flex; align-items: center; gap: 10px; padding: 9px 18px; cursor: grab; }
  .dj-slot.dragging { opacity: 0.4; }
  .dj-slot .n { color: var(--faint); font-size: 11px; width: 18px; text-align: right; }
  .dj-slot .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .dj-slot .t small { color: var(--dim); }
  .dj-slot .num { font: 12px ui-monospace, "SF Mono", Menlo, monospace; color: var(--dim); }
  .dj-slot .rm { background: transparent; border: none; color: var(--faint); font-size: 13px; padding: 2px 7px; }
  .dj-slot .rm:hover { color: var(--red); filter: none; }
  .dj-link { display: flex; align-items: center; gap: 8px; padding: 0 18px 0 46px; height: 14px; }
  .dj-link .line { flex: none; width: 46px; height: 3px; border-radius: 2px; }
  .dj-link.good .line { background: var(--accent); }
  .dj-link.ok .line { background: var(--amber); }
  .dj-link.clash .line { background: var(--red); }
  .dj-link .why { font-size: 10.5px; color: var(--faint); }
  .dj-empty-set { color: var(--faint); font-size: 13px; padding: 16px 18px; }
  .dj-name-input { flex: 1; background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 11px; font: 13px -apple-system, sans-serif; outline: none; }
  .dj-name-input:focus { border-color: var(--accent-dim); }
  .dj-viz { display: flex; gap: 16px; margin-top: 16px; }
  .dj-viz-card { flex: 1; padding: 14px; min-height: 100px; }
```

- [ ] **Step 2: Add the JS** (append after Task 10's block; delete the Task-10 stub `addToSet`)

```js
/* ---- set builder ---- */
function djTrack(id) { return djTracks.find((t) => t.id === id); }

function addToSet(id) {
  if (!djSet.includes(id)) djSet.push(id);
  renderDJRows();
  renderSet();
}

function removeFromSet(id) {
  djSet = djSet.filter((x) => x !== id);
  renderDJRows();
  renderSet();
}

async function renderSet() {
  const list = $("dj-set-list");
  const tracks = djSet.map(djTrack).filter(Boolean);
  if (!tracks.length) {
    list.innerHTML = `<div class="dj-empty-set">Add analyzed tracks from the browser above, then drag to order.</div>`;
    $("dj-set-summary").innerHTML = "";
    if (typeof renderWheel === "function") renderWheel([]);
    if (typeof renderEnergy === "function") renderEnergy([]);
    return;
  }
  let ratings = [];
  if (tracks.length > 1) {
    try {
      const r = await fetch("/api/dj/compatibility", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: djSet }),
      });
      if (r.ok) ratings = (await r.json()).ratings;
    } catch { /* markers just don't render */ }
  }
  const bpms = tracks.map((t) => t.bpm).filter(Boolean);
  const keys = [...new Set(tracks.map((t) => t.camelot).filter(Boolean))];
  $("dj-set-summary").textContent =
    `${tracks.length} tracks · ${Math.min(...bpms).toFixed(0)}–${Math.max(...bpms).toFixed(0)} BPM · keys: ${keys.join(" ")}`;
  list.innerHTML = tracks.map((t, i) => {
    const slot = `<div class="dj-slot" draggable="true" data-id="${t.id}">
      <span class="n">${i + 1}</span>
      <span class="dj-key" style="background:${camelotColor(t.camelot)};color:#fff">${t.camelot || "?"}</span>
      <span class="t">${esc(t.title)} <small>· ${esc(t.artist)}</small></span>
      <span class="num">${t.bpm ? t.bpm.toFixed(1) : ""}</span>
      <button class="rm" data-id="${t.id}" title="Remove">×</button>
    </div>`;
    const link = i < tracks.length - 1 && ratings[i]
      ? `<div class="dj-link ${ratings[i]}"><span class="line"></span><span class="why">${ratings[i]}</span></div>`
      : "";
    return slot + link;
  }).join("");
  if (typeof renderWheel === "function") renderWheel(tracks);
  if (typeof renderEnergy === "function") renderEnergy(tracks);
}

/* drag to reorder */
let dragId = null;
$("dj-set-list").addEventListener("dragstart", (e) => {
  const slot = e.target.closest(".dj-slot");
  if (!slot) return;
  dragId = slot.dataset.id;
  slot.classList.add("dragging");
});
$("dj-set-list").addEventListener("dragend", (e) => {
  e.target.closest(".dj-slot")?.classList.remove("dragging");
  dragId = null;
});
$("dj-set-list").addEventListener("dragover", (e) => {
  e.preventDefault();
  const over = e.target.closest(".dj-slot");
  if (!over || !dragId || over.dataset.id === dragId) return;
  const from = djSet.indexOf(dragId);
  const to = djSet.indexOf(over.dataset.id);
  djSet.splice(from, 1);
  djSet.splice(to, 0, dragId);
  renderSet();
});
$("dj-set-list").addEventListener("click", (e) => {
  const rm = e.target.closest(".rm");
  if (rm) removeFromSet(rm.dataset.id);
});

/* save to rekordbox */
$("dj-save").onclick = async () => {
  const name = $("dj-set-name").value.trim();
  const btn = $("dj-save");
  if (!name || !djSet.length) {
    btn.textContent = !name ? "Name the set first" : "Add tracks first";
    setTimeout(() => { btn.textContent = "Save to rekordbox"; }, 2000);
    return;
  }
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const r = await fetch("/api/dj/export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ids: djSet }),
    });
    const d = await r.json();
    btn.textContent = r.ok ? `Saved as “${d.playlist}”` : (d.detail || "Failed");
  } catch {
    btn.textContent = "Failed";
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = "Save to rekordbox"; }, 3500);
  }
};
renderSet();   // initial empty state
```

- [ ] **Step 3: Verify by hand**

Reload the page: add a few analyzed tracks, drag to reorder — green/amber/red links appear between neighbors and update on reorder; the summary line shows count/BPM range/keys; remove works; Save with rekordbox OPEN shows "close rekordbox first" (the 409 detail). Run `uv run pytest tests/` — all pass.

- [ ] **Step 4: Commit**

```bash
git add spotify_dl/static/index.html
git commit -m "feat: manual set builder with drag ordering and compatibility markers"
```

---

### Task 12: Frontend — Camelot wheel

**Files:**
- Modify: `spotify_dl/static/index.html`

**Interfaces:**
- Consumes: `renderSet()` hook, `djTracks`, `camelotColor` (Tasks 10–11); wheel-segment click filters the browser via `$("dj-camelot").value` + `refreshDJTracks()`.
- Produces: `renderWheel(tracks)` — called by `renderSet()`.

- [ ] **Step 1: Add the JS** (append after Task 11's block)

```js
/* ---- camelot wheel ---- */
function wheelArc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

function renderWheel(tracks) {
  const size = 260, cx = size / 2, cy = size / 2;
  const present = new Set(tracks.map((t) => t.camelot).filter(Boolean));
  const counts = {};
  tracks.forEach((t) => { if (t.camelot) counts[t.camelot] = (counts[t.camelot] || 0) + 1; });
  const seg = (2 * Math.PI) / 12;
  let paths = "";
  for (let n = 1; n <= 12; n++) {
    const a0 = (n - 1) * seg - seg / 2, a1 = a0 + seg;
    for (const [ring, r0, r1] of [["A", 52, 88], ["B", 90, 126]]) {
      const code = `${n}${ring}`;
      const on = present.has(code);
      paths += `<path d="${wheelArc(cx, cy, r0, r1, a0, a1)}" data-code="${code}"
        fill="${camelotColor(code)}" opacity="${on ? 1 : 0.16}"
        stroke="var(--panel)" stroke-width="1.5" style="cursor:pointer"/>`;
      const mid = (a0 + a1) / 2, rm = (r0 + r1) / 2;
      const tx = cx + rm * Math.sin(mid), ty = cy - rm * Math.cos(mid);
      paths += `<text x="${tx}" y="${ty + 3.5}" text-anchor="middle" pointer-events="none"
        font-size="10" font-weight="600" fill="${on ? "#fff" : "var(--faint)"}">${code}${counts[code] ? "·" + counts[code] : ""}</text>`;
    }
  }
  // chords between consecutive tracks show each harmonic move
  let chords = "";
  const pos = (code) => {
    const n = parseInt(code), ring = code.endsWith("A");
    const a = (n - 1) * seg, r = ring ? 70 : 108;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const seq = tracks.filter((t) => t.camelot);
  for (let i = 0; i < seq.length - 1; i++) {
    if (seq[i].camelot === seq[i + 1].camelot) continue;
    const [x0, y0] = pos(seq[i].camelot), [x1, y1] = pos(seq[i + 1].camelot);
    chords += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"
      stroke="var(--text)" stroke-width="1.4" opacity="0.5" marker-end="url(#dj-arr)"/>`;
  }
  $("dj-wheel").innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="100%">
    <defs><marker id="dj-arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="var(--text)" opacity="0.6"/></marker></defs>
    ${paths}${chords}</svg>`;
}
$("dj-wheel").addEventListener("click", (e) => {
  const code = e.target.closest("path[data-code]")?.dataset.code;
  if (!code) return;
  $("dj-camelot").value = $("dj-camelot").value === code ? "" : code;
  refreshDJTracks();
});
```

- [ ] **Step 2: Verify by hand**

Reload: with tracks in the set, the wheel highlights their segments (with counts), draws arrows for each move between consecutive different keys; clicking a segment filters the track browser to that key (click again to clear). Empty set → all segments dim.

- [ ] **Step 3: Commit**

```bash
git add spotify_dl/static/index.html
git commit -m "feat: camelot wheel visualization with move arrows and key filter"
```

---

### Task 13: Frontend — energy curve

**Files:**
- Modify: `spotify_dl/static/index.html`

**Interfaces:**
- Consumes: `renderSet()` hook (Task 11); `POST /api/dj/energy` (Task 9).
- Produces: `renderEnergy(tracks)` — called by `renderSet()`.

- [ ] **Step 1: Add the JS** (append after Task 12's block)

```js
/* ---- energy curve ---- */
const energyCache = {};       // track id -> LUFS | null (session-level)

async function renderEnergy(tracks) {
  const box = $("dj-energy");
  if (tracks.length < 2) {
    box.innerHTML = `<div class="dj-empty-set">Energy curve appears with 2+ tracks.</div>`;
    return;
  }
  const missing = tracks.filter((t) => !(t.id in energyCache)).map((t) => t.id);
  if (missing.length) {
    box.innerHTML = `<div class="dj-empty-set">Measuring energy… (first time per track)</div>`;
    try {
      const r = await fetch("/api/dj/energy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: missing }),
      });
      if (r.ok) Object.assign(energyCache, (await r.json()).energy);
      else missing.forEach((id) => { energyCache[id] = null; });
    } catch { missing.forEach((id) => { energyCache[id] = null; }); }
  }
  const w = 420, h = 150, pad = 26;
  const es = tracks.map((t) => energyCache[t.id]);
  const known = es.filter((e) => e != null);
  if (known.length < 2) {
    box.innerHTML = `<div class="dj-empty-set">Not enough energy data for these files.</div>`;
    return;
  }
  const lo = Math.min(...known) - 1, hi = Math.max(...known) + 1;
  const bpms = tracks.map((t) => t.bpm).filter(Boolean);
  const blo = Math.min(...bpms) - 2, bhi = Math.max(...bpms) + 2;
  const x = (i) => pad + (i / (tracks.length - 1)) * (w - 2 * pad);
  const yE = (e) => h - pad - ((e - lo) / (hi - lo)) * (h - 2 * pad);
  const yB = (b) => h - pad - ((b - blo) / (bhi - blo)) * (h - 2 * pad);
  const ePts = es.map((e, i) => e != null ? `${x(i)},${yE(e)}` : null).filter(Boolean).join(" ");
  const bPts = tracks.map((t, i) => t.bpm ? `${x(i)},${yB(t.bpm)}` : null).filter(Boolean).join(" ");
  const dots = es.map((e, i) => e != null
    ? `<circle cx="${x(i)}" cy="${yE(e)}" r="3.5" fill="var(--accent)"><title>${esc(tracks[i].title)}: ${e.toFixed(1)} LUFS</title></circle>`
    : "").join("");
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%">
    <polyline points="${bPts}" fill="none" stroke="var(--faint)" stroke-width="1.2" stroke-dasharray="4 3"/>
    <polygon points="${pad},${h - pad} ${ePts} ${x(tracks.length - 1)},${h - pad}" fill="var(--accent)" opacity="0.12"/>
    <polyline points="${ePts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${dots}
    <text x="${pad}" y="12" font-size="10" fill="var(--dim)">energy (loudness)</text>
    <text x="${w - pad}" y="12" font-size="10" fill="var(--faint)" text-anchor="end">- - BPM</text>
  </svg>`;
}
```

- [ ] **Step 2: Verify by hand**

Reload: with 2+ tracks in the set, the energy card first shows "Measuring energy…" then draws the green loudness area + dashed BPM line; hover a dot to see the LUFS. Reordering redraws. (First measurement runs ffmpeg per track — a few seconds each — then caches.)

- [ ] **Step 3: Commit**

```bash
git add spotify_dl/static/index.html
git commit -m "feat: set energy curve from cached ffmpeg loudness"
```

---

### Task 14: Live end-to-end verification (main session, NOT a subagent)

**Files:** none (verification + any bug-fix commits it produces)

This task is executed by the main session because it controls the rekordbox app via computer-use (quit/open) and judges UI behavior. Sequence:

- [ ] **Step 1:** `uv run pytest tests/ -v` — full suite green.
- [ ] **Step 2:** Start the UI (`SPOTIFY_DL_NO_BROWSER=1 uv run spotify-dl-ui`, background). With rekordbox OPEN: DJ tab shows "rekordbox is open", track browser lists the real collection with BPM/Camelot, import button (if any new files) is disabled, export returns the 409 message in the Save button.
- [ ] **Step 3:** Quit rekordbox (computer-use). Banner flips to "rekordbox is closed" within ~5s. Run an import of the download folder — verify dedup report (imported vs skipped counts) and that a `master.backup.spotify-dl.*` file appeared in `~/Library/Pioneer/rekordbox/`.
- [ ] **Step 4:** Build a small set (3–5 real tracks), drag-reorder, confirm markers + wheel + energy curve. Save the set with a test name → success message.
- [ ] **Step 5:** Reopen rekordbox (computer-use `open_application`). Verify: the new playlist exists with the right tracks in the right order; imported tracks appear in the collection and get analyzed (Auto-Analysis); NO duplicates were created; existing playlists untouched.
- [ ] **Step 6:** Fix anything found (with tests where applicable), commit.

---

## Self-Review Notes

- Spec coverage: camelot (T1), compatibility hints (T2), energy (T3, T9, T13), dedup (T4, T6), read layer + normalized record + sampler exclusion (T5), guarded additive import + backup + idempotency-via-dedup (T6), new-playlist-only export + uniquify (T7), status/tracks API (T8), import/compat/energy/export API + auto-import on download completion (T9), status banner + browser (T10), manual set builder + markers + summary (T11), wheel (T12), energy curve (T13), live E2E (T14). Auto-ordering: correctly absent. One-time Auto-Analysis setup note: surfaced in the banner hint (T10).
- The spec's track record has `energy` inline; implemented as a separate on-demand endpoint + cache so `/api/dj/tracks` stays fast (1,465 tracks × ffmpeg would take ~an hour). This is a deliberate, documented deviation in mechanism, not behavior.
- `playlists` field is returned by `load_tracks` (T5) and available to the UI; browser doesn't display it in v1 (kept minimal).
