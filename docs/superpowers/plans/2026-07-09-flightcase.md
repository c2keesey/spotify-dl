# Flightcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Helen places hot cues and loops on her set from an iPad on a plane; her work comes home as rekordbox hot cues via XML import.

**Architecture:** Crate's backend exports a `.crate` zip bundle (byte-identical audio + precomputed waveform peaks + manifest). A new standalone offline PWA (`companion/`) imports the bundle into OPFS/IndexedDB, provides waveform + cue-pad editing, and exports a tiny `cues.json`. The backend turns `cues.json` into a rekordbox XML with `POSITION_MARK` nodes that Helen imports by hand as a NEW playlist.

**Tech Stack:** Python (FastAPI, ffmpeg subprocess, zipfile, stdlib ElementTree) · Vite + React 19 + TypeScript + Tailwind 3 + shadcn/ui (bun) · fflate, @dnd-kit/sortable, vite-plugin-pwa · pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-flightcase-design.md` — the spec governs on any conflict.

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- **`master.db` is never written by this feature.** Bundle export reads the library; cue import produces an XML document. No task may add a `master.db` write path.
- **Audio is copied byte-for-byte.** No transcode, no resample, no normalization. Encoder padding would silently shift cue timestamps.
- **Crate never moves, deletes, or "repairs" the user's audio files.**
- **No test may read or write the real `master.db`.** The autouse fixtures in `tests/conftest.py` stay in force; backend tests stub the collection.
- **Cues are the only irreplaceable data.** Persist cues to IndexedDB on every edit; the bundle is reconstructible from the Files app.
- **Components come from shadcn/ui**, matching the existing `frontend/` install (Radix primitives + `class-variance-authority` + `tailwind-merge`). No second component library. The waveform and cue pads are bespoke.
- Hot cue slots are `0..7`, serialized to rekordbox A–H. A loop is a slot with an end time (`Type="4"`, carries `End`).
- User standing rules: exports always create a NEW playlist — never modify or overwrite an existing one ("for safety make sure it pulls in to new playlist … always to avoid overwrites"); dedup checks run before any import ("do a dup check always frist too"). This feature satisfies both by construction: the XML route is additive-only and imports are hand-triggered in rekordbox.
- The companion app makes **no network requests after its shell is cached** — audio moves only over AirDrop.
- Python via `uv`; frontend via `bun`. Backend tests: `uv run pytest tests/`. Companion tests: `cd companion && bun run test`.

## Deviations from spec (deliberate, small)

- `bundle.build(tracks, name, stem, out_dir, rate=200)` takes already-resolved track records instead of `(set_dir, stem, out_dir)`. Resolution against the live collection stays in `web.py` (mirroring `dj_open_set`), so `bundle.py` never imports `rekordbox` and tests run on synthetic records. The spec's intent — resolve via `setfile.resolve_entries`, exclude non-present files, report skips — is unchanged.
- The `navigator.storage.persist()` iOS spike cannot run in this session (no physical iPad). The Import screen is implemented so the answer is a tuning knob, not a blocker: it calls `persist()`, and shows a prominent eviction warning whenever the grant is false or the API is absent. A follow-up item records the on-device check.

## File Structure

```
spotify_dl/bundle.py            NEW  peaks(), build(), parse_cues()
spotify_dl/setfile.py           MOD  to_rekordbox_xml(..., cues=None)
spotify_dl/web.py               MOD  POST /api/dj/bundle, POST /api/dj/cues/xml
tests/test_bundle.py            NEW
tests/test_setfile.py           MOD  POSITION_MARK cases
tests/test_web.py               MOD  endpoint cases
.gitignore                      MOD  bundles/
frontend/src/lib/api.ts         MOD  djBundle, djCuesXml
frontend/src/pages/DjSets/SetLibrary.tsx  MOD  Bundle + Import-cues actions

companion/                      NEW  standalone Vite app (own package.json, bun)
  package.json, vite.config.ts, vitest.config.ts, tsconfig*.json,
  tailwind.config.ts, postcss.config.js, index.html, public/
  src/main.tsx, src/App.tsx, src/index.css
  src/components/ui/{button,card,dialog,input,badge,separator,scroll-area}.tsx
  src/lib/utils.ts              cn()
  src/lib/types.ts              Manifest, TrackMeta, Cue, StoredSet
  src/lib/manifest.ts           parseManifest()
  src/lib/cueStore.ts           pure reducer for cue edits
  src/lib/waveMath.ts           timeAtX, xAtTime, sliceForView
  src/lib/cuesExport.ts         buildCuesJson()
  src/lib/idb.ts                IndexedDB wrapper (sets, cues stores)
  src/lib/opfs.ts               OPFS write/read/delete + quota
  src/lib/importBundle.ts       fflate unzip pipeline → OPFS + IDB
  src/screens/ImportScreen.tsx
  src/screens/SetScreen.tsx
  src/screens/TrackScreen.tsx
  src/components/Waveform.tsx   bespoke canvas
  src/components/CuePads.tsx    bespoke pads
  src/components/Transport.tsx
  src/lib/*.test.ts             vitest (pure logic only)
  README.md                     build + deploy (static HTTPS host)
```

---

### Task 1: `spotify_dl/bundle.py` — peaks, build, parse_cues

**Files:**
- Create: `spotify_dl/bundle.py`
- Test: `tests/test_bundle.py`

**Interfaces:**
- Produces: `peaks(path, rate=200) -> bytes`; `build(tracks, name, stem, out_dir, rate=200) -> (Path, list[dict])`; `parse_cues(data) -> dict` raising `ValueError`. Task 3's endpoints call all three.
- `parse_cues` return shape: `{"set": str, "name": str, "order": list[str], "cues": {track_id: [{"num": int, "name": str, "start": float, "end": float|None}, ...]}}`.

- [ ] **Step 1: Write failing tests** in `tests/test_bundle.py`

```python
"""bundle.py tests. A synthetic wav is generated with the stdlib `wave`
module — never a real library file, never master.db. peaks() shells out to
ffmpeg (already a test-suite requirement)."""

import io
import json
import math
import wave
import zipfile

import pytest

from spotify_dl import bundle


@pytest.fixture()
def sine_wav(tmp_path):
    """2-second 440Hz mono 16-bit wav at 8kHz."""
    p = tmp_path / "tone.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        frames = bytearray()
        for i in range(8000 * 2):
            v = int(30000 * math.sin(2 * math.pi * 440 * i / 8000))
            frames += v.to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))
    return p


def _records(paths, states=None):
    states = states or ["present"] * len(paths)
    return [{"id": str(4000 + i), "title": f"T{i}", "artist": f"A{i}",
             "bpm": 174.0, "key_name": "Fm", "camelot": "4A",
             "genre": "DnB", "duration": 2, "file_path": str(p),
             "file_state": s}
            for i, (p, s) in enumerate(zip(paths, states))]


def test_peaks_length_matches_rate_times_duration(sine_wav):
    data = bundle.peaks(sine_wav, rate=200)
    assert isinstance(data, bytes)
    # 2s at 200/s = 400 buckets; allow ±1 bucket of codec slack
    assert abs(len(data) - 400) <= 1
    assert max(data) > 100  # a loud sine actually registers


def test_peaks_silence_is_near_zero(tmp_path):
    p = tmp_path / "silence.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 8000)
    data = bundle.peaks(p, rate=200)
    assert max(data) <= 2


def test_build_zip_contents_and_byte_identical_audio(sine_wav, tmp_path):
    tracks = _records([sine_wav])
    out, skipped = bundle.build(tracks, "Helen's Set", "helens-set", tmp_path)
    assert skipped == []
    with zipfile.ZipFile(out) as z:
        names = set(z.namelist())
        assert "manifest.json" in names
        m = json.loads(z.read("manifest.json"))
        assert m["schema"] == 1
        assert m["set"] == "helens-set"
        assert m["name"] == "Helen's Set"
        assert m["order"] == ["4000"]
        t = m["tracks"][0]
        assert t["audio"] == "audio/4000.wav"
        assert t["peaks"] == "peaks/4000.bin"
        assert t["peaks_rate"] == 200
        # byte-for-byte: the zip member IS the source file
        assert z.read("audio/4000.wav") == sine_wav.read_bytes()
        assert len(z.read("peaks/4000.bin")) > 0


def test_build_excludes_missing_files(sine_wav, tmp_path):
    tracks = _records([sine_wav, "/nowhere/gone.mp3"],
                      states=["present", "missing"])
    out, skipped = bundle.build(tracks, "S", "s", tmp_path)
    assert [s["id"] for s in skipped] == ["4001"]
    with zipfile.ZipFile(out) as z:
        m = json.loads(z.read("manifest.json"))
        assert [t["id"] for t in m["tracks"]] == ["4000"]


def test_build_with_nothing_present_raises(tmp_path):
    tracks = _records(["/nowhere/a.mp3"], states=["missing"])
    with pytest.raises(ValueError):
        bundle.build(tracks, "S", "s", tmp_path)


VALID = {
    "schema": 1, "set": "helens-set", "exported_at": "x",
    "order": ["2", "1"],
    "tracks": [{"id": "1", "cues": [
        {"num": 0, "name": "drop", "start": 34.512, "end": None},
        {"num": 1, "name": "build", "start": 12.0, "end": 20.0},
    ]}],
}


def test_parse_cues_valid():
    out = bundle.parse_cues(VALID)
    assert out["order"] == ["2", "1"]
    assert out["cues"]["1"][0] == {"num": 0, "name": "drop",
                                  "start": 34.512, "end": None}


@pytest.mark.parametrize("mutate,msg", [
    (lambda d: d.update(schema=2), "schema"),
    (lambda d: d["tracks"][0]["cues"][0].update(num=8), "slot"),
    (lambda d: d["tracks"][0]["cues"][0].update(num=-1), "slot"),
    (lambda d: d["tracks"][0]["cues"][0].update(start=-0.1), "start"),
    (lambda d: d["tracks"][0]["cues"][1].update(end=12.0), "end"),
    (lambda d: d["tracks"][0]["cues"].append(
        {"num": 0, "name": "", "start": 1.0, "end": None}), "duplicate"),
])
def test_parse_cues_rejects(mutate, msg):
    import copy
    d = copy.deepcopy(VALID)
    mutate(d)
    with pytest.raises(ValueError, match=msg):
        bundle.parse_cues(d)
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/test_bundle.py -v` → FAIL (no module `bundle`).

- [ ] **Step 3: Implement `spotify_dl/bundle.py`**

```python
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

    manifest = {
        "schema": 1, "set": stem, "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order": [str(t["id"]) for t in present],
        "tracks": [],
    }
    with zipfile.ZipFile(out, "w") as z:
        for t in present:
            tid = str(t["id"])
            src = Path(t["file_path"])
            audio_name = f"audio/{tid}{src.suffix.lower()}"
            peaks_name = f"peaks/{tid}.bin"
            # STORED: mp3/m4a don't compress and byte identity is the point.
            z.write(src, audio_name, compress_type=zipfile.ZIP_STORED)
            z.writestr(peaks_name, peaks(src, rate=rate),
                       compress_type=zipfile.ZIP_DEFLATED)
            manifest["tracks"].append({
                "id": tid, "title": t.get("title") or "",
                "artist": t.get("artist") or "",
                "bpm": t.get("bpm"), "key_name": t.get("key_name") or "",
                "camelot": t.get("camelot") or "",
                "genre": t.get("genre") or "",
                "duration": t.get("duration"),
                "audio": audio_name, "peaks": peaks_name, "peaks_rate": rate,
            })
        z.writestr("manifest.json", json.dumps(manifest, indent=2),
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
```

- [ ] **Step 4: Run tests** — `uv run pytest tests/test_bundle.py -v` → all PASS.
- [ ] **Step 5: Commit** — `git add spotify_dl/bundle.py tests/test_bundle.py && git commit -m "feat: bundle.py — .crate builder, peaks, cues.json validator"`

---

### Task 2: `POSITION_MARK` in `setfile.to_rekordbox_xml`

**Files:**
- Modify: `spotify_dl/setfile.py:334` (`to_rekordbox_xml`)
- Test: `tests/test_setfile.py`

**Interfaces:**
- Produces: `to_rekordbox_xml(tracks, playlist_name, cues=None)`. `cues` is `parse_cues(...)["cues"]`: `{track_id: [{"num", "name", "start", "end"}]}`. Task 3 passes it through.
- **Absent `cues`, output is byte-identical to today's** — existing tests must keep passing untouched.

- [ ] **Step 1: Write failing tests** (append to `tests/test_setfile.py`, following its existing style)

```python
def test_xml_position_marks_point_and_loop():
    tracks = [{"id": "4471", "title": "333", "artist": "Whyte Fang",
               "bpm": 174.0, "key_name": "Fm", "duration": 214,
               "file_path": "/Music/333.mp3"}]
    cues = {"4471": [
        {"num": 0, "name": "drop", "start": 34.512, "end": None},
        {"num": 1, "name": "build", "start": 12.0, "end": 20.0},
    ]}
    xml = setfile.to_rekordbox_xml(tracks, "S", cues=cues)
    root = ET.fromstring(xml)
    track = root.find("COLLECTION/TRACK")
    marks = track.findall("POSITION_MARK")
    assert len(marks) == 2
    point, loop = marks
    assert point.get("Name") == "drop"
    assert point.get("Type") == "0"
    assert point.get("Start") == "34.512"
    assert point.get("Num") == "0"
    assert point.get("End") is None
    assert loop.get("Type") == "4"
    assert loop.get("Start") == "12.000"
    assert loop.get("End") == "20.000"
    assert loop.get("Num") == "1"


def test_xml_without_cues_is_byte_identical_to_before():
    tracks = [{"id": "1", "title": "t", "artist": "a", "bpm": 120,
               "key_name": "Am", "duration": 100, "file_path": "/m/t.mp3"}]
    assert (setfile.to_rekordbox_xml(tracks, "S")
            == setfile.to_rekordbox_xml(tracks, "S", cues=None))
    root = ET.fromstring(setfile.to_rekordbox_xml(tracks, "S"))
    assert root.find("COLLECTION/TRACK/POSITION_MARK") is None


def test_xml_cues_for_unknown_track_id_ignored():
    tracks = [{"id": "1", "title": "t", "artist": "a", "bpm": 120,
               "key_name": "Am", "duration": 100, "file_path": "/m/t.mp3"}]
    xml = setfile.to_rekordbox_xml(tracks, "S", cues={"999": [
        {"num": 0, "name": "", "start": 1.0, "end": None}]})
    assert ET.fromstring(xml).find("COLLECTION/TRACK/POSITION_MARK") is None
```

- [ ] **Step 2: Run** — `uv run pytest tests/test_setfile.py -v` → new tests FAIL (unexpected keyword `cues`).

- [ ] **Step 3: Implement.** In `to_rekordbox_xml`, change the signature to `def to_rekordbox_xml(tracks, playlist_name, cues=None):` and inside the COLLECTION loop, after `ET.SubElement(collection, "TRACK", ...)` capture the element and append marks:

```python
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
```

Update the module docstring's mention of XML if needed. No other behavior changes.

- [ ] **Step 4: Run** — `uv run pytest tests/test_setfile.py -v` → all PASS (old tests untouched).
- [ ] **Step 5: Commit** — `git commit -m "feat: POSITION_MARK hot cues/loops in rekordbox XML export"`

---

### Task 3: endpoints `POST /api/dj/bundle` and `POST /api/dj/cues/xml`

**Files:**
- Modify: `spotify_dl/web.py` (after `dj_export_xml`, ~line 1090), `.gitignore`
- Test: `tests/test_web.py`

**Interfaces:**
- Consumes: `bundle.build`, `bundle.parse_cues`, `setfile.to_rekordbox_xml(..., cues=)`, existing `setfile.find/load/resolve_entries`, `_dj_tracks_or_503()`.
- Produces (Task 4 consumes): `POST /api/dj/bundle` body `{"set": stem}` → zip bytes, `Content-Disposition: attachment; filename="<stem>.crate"`, header `X-Skipped-Tracks: <count>`; 404 unknown set, 400 nothing present (detail lists skipped titles), 503 no collection. `POST /api/dj/cues/xml` body `{"cues": {…cues.json…}}` → XML text (`application/xml`, attachment `<name> cues.xml`), header `X-Unknown-Ids` (comma-joined ids not in the library, empty when none); 400 invalid payload or zero known ids.

- [ ] **Step 1: Write failing tests** (append to `tests/test_web.py`, following its existing stubbing pattern for the collection — read the file's existing `/api/dj/export/xml` tests first and mirror how they monkeypatch `rekordbox`/`web`).

Cases:
```python
# POST /api/dj/bundle
def test_bundle_unknown_set_404(...)          # no such stem in SETS_DIR
def test_bundle_streams_zip_and_skip_header(...)  # tmp SETS_DIR with a saved set,
    # stubbed collection: 2 present (real tmp wav files) + 1 missing;
    # assert content-type zip, filename .crate, X-Skipped-Tracks == "1",
    # zip opens and manifest lists 2 tracks
def test_bundle_nothing_present_400(...)      # detail mentions skipped

# POST /api/dj/cues/xml
def test_cues_xml_roundtrip(...)   # stub collection with ids 1,2; valid payload
    # with order [2,1] and cues on both; assert playlist NODE order 2,1 and
    # POSITION_MARK present; X-Unknown-Ids == ""
def test_cues_xml_reports_unknown_ids(...)   # payload names id 999 too;
    # 200, XML emitted for known, X-Unknown-Ids == "999"
def test_cues_xml_invalid_payload_400(...)   # schema 2 → 400, detail mentions schema
def test_cues_xml_no_known_ids_400(...)
```

Write them as real tests with the file's established fixtures (TestClient, monkeypatched `SETS_DIR`, stubbed `load_tracks`). Bundle tests write real temp wavs (reuse the `wave` recipe from `tests/test_bundle.py`) so `bundle.peaks` can decode.

- [ ] **Step 2: Run** — `uv run pytest tests/test_web.py -k "bundle or cues" -v` → FAIL (404s).

- [ ] **Step 3: Implement** in `web.py`:

```python
BUNDLES_DIR = REPO_ROOT / "bundles"


class BundleRequest(BaseModel):
    set: str


class CuesXmlRequest(BaseModel):
    cues: dict


@app.post("/api/dj/bundle")
def dj_bundle(req: BundleRequest):
    """Build a Flightcase .crate for a saved set. Read-only w.r.t. rekordbox:
    resolves the set against the collection, copies audio byte-for-byte, and
    never opens master.db for write — safe while rekordbox runs."""
    m3u8 = setfile.find(SETS_DIR, req.set)
    if m3u8 is None:
        raise HTTPException(404, f"no set named {req.set!r}")
    data = setfile.load(m3u8)
    all_tracks = _dj_tracks_or_503()
    by_id = {t["id"]: t for t in all_tracks}
    by_path = {t["file_path"]: t for t in all_tracks if t.get("file_path")}
    tracks, _, unresolved = setfile.resolve_entries(
        data.get("tracks", []), by_id, by_path)
    if not tracks:
        raise HTTPException(400, "set resolves to no library tracks")
    try:
        path, skipped = bundle.build(tracks, data.get("name") or m3u8.stem,
                                     m3u8.stem, BUNDLES_DIR)
    except ValueError:
        names = [f"{t.get('artist')} - {t.get('title')}" for t in tracks]
        raise HTTPException(
            400, "no tracks with a present audio file; skipped: "
                 + "; ".join(names))
    return FileResponse(
        path, media_type="application/zip",
        filename=f"{m3u8.stem}.crate",
        headers={"X-Skipped-Tracks": str(len(skipped) + len(unresolved))})


@app.post("/api/dj/cues/xml")
def dj_cues_xml(req: CuesXmlRequest):
    """Turn a Flightcase cues.json into rekordbox-importable XML with
    POSITION_MARK hot cues. Unknown track ids are reported in a header and
    the XML is emitted for the rest — the cues file is the irreplaceable
    artifact and must not fail whole on a partial mismatch. Never opens
    master.db for write; importing the XML is a manual, additive step that
    always creates a NEW playlist."""
    try:
        parsed = bundle.parse_cues(req.cues)
    except ValueError as e:
        raise HTTPException(400, str(e))
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    wanted = list(dict.fromkeys(
        [*parsed["order"], *parsed["cues"].keys()]))
    known = [i for i in wanted if i in by_id]
    unknown = [i for i in wanted if i not in by_id]
    if not known:
        raise HTTPException(400, "no track ids match the library")
    tracks = [by_id[i] for i in known]
    name = parsed["name"] or parsed["set"] or "Flightcase cues"
    xml = setfile.to_rekordbox_xml(tracks, name, cues=parsed["cues"])
    return Response(
        content=xml, media_type="application/xml",
        headers={"Content-Disposition":
                 f'attachment; filename="{setfile._safe_name(name)} cues.xml"',
                 "X-Unknown-Ids": ",".join(unknown)})
```

Add `bundle` to the `from spotify_dl import …` line. Add `bundles/` to `.gitignore` next to `sets/`.

- [ ] **Step 4: Run** — `uv run pytest tests/test_web.py -v` → all PASS; then the whole suite `uv run pytest tests/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: /api/dj/bundle and /api/dj/cues/xml endpoints"`

---

### Task 4: Crate UI — bundle export + cues import actions

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/pages/DjSets/SetLibrary.tsx`

**Interfaces:**
- Consumes: Task 3's endpoints.
- Produces: `api.djBundle(stem) -> Promise<{blob: Blob; filename: string; skipped: number}>`; `api.djCuesXml(cues: unknown) -> Promise<{xml: string; unknown: string[]}>`.

- [ ] **Step 1:** Read `SetLibrary.tsx` and mirror its existing action patterns (buttons, toasts via `sonner`, shadcn components already in `components/ui`).

- [ ] **Step 2:** Add to `api.ts` (matching its house style and doc-comment voice):

```ts
  /** Flightcase bundle: audio + peaks + manifest as one .crate zip. Read-only
   *  w.r.t. rekordbox; skipped-track count rides a response header. */
  djBundle: async (stem: string) => {
    const res = await fetch("/api/dj/bundle", post({ set: stem }));
    if (!res.ok) throw new ApiError(res.status, await detailOf(res));
    return {
      blob: await res.blob(),
      filename: `${stem}.crate`,
      skipped: Number(res.headers.get("X-Skipped-Tracks") || 0),
    };
  },
  /** cues.json (from the Flightcase app) -> rekordbox XML with hot cues.
   *  Unknown ids come back in a header; the XML still covers the rest. */
  djCuesXml: async (cues: unknown) => {
    const res = await fetch("/api/dj/cues/xml", post({ cues }));
    if (!res.ok) throw new ApiError(res.status, await detailOf(res));
    const unknown = (res.headers.get("X-Unknown-Ids") || "").split(",").filter(Boolean);
    return { xml: await res.text(), unknown };
  },
```

- [ ] **Step 3:** In `SetLibrary.tsx`: a per-set "Bundle" action that calls `djBundle`, saves the blob via a temporary object-URL anchor click, and toasts "N tracks skipped (missing files)" when `skipped > 0`; and one "Import cues" action (header-level) that opens a hidden `<input type="file" accept="application/json,.json">`, parses the file with `JSON.parse` (toast the error on bad JSON), calls `djCuesXml`, saves the XML the same object-URL way, and toasts unknown-id counts when present. Follow the page's existing visual language (engraved labels, mono data font). No new component library.

- [ ] **Step 4:** `cd frontend && bun run build && bun run test` → both pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(crate): bundle export + cues->XML import actions"`

---

### Task 5: `companion/` scaffold — Vite + Tailwind + shadcn + PWA + vitest

**Files:**
- Create: `companion/package.json`, `companion/vite.config.ts`, `companion/vitest.config.ts`, `companion/tsconfig.json` (+ app/node variants), `companion/tailwind.config.ts`, `companion/postcss.config.js`, `companion/index.html`, `companion/src/main.tsx`, `companion/src/App.tsx`, `companion/src/index.css`, `companion/src/lib/utils.ts`, `companion/src/components/ui/{button,card,dialog,input,badge,separator,scroll-area}.tsx`, `companion/README.md`, `companion/public/` icons.
- Modify: `.gitignore` (`companion/node_modules/`, `companion/dist/`).

**Interfaces:**
- Produces: a building, testing app shell later tasks fill in. `App.tsx` owns a `screen` state: `{name:"import"} | {name:"set"} | {name:"track", trackId:string}` — plain `useState`, no router (three screens, offline, no URLs to deep-link).

- [ ] **Step 1:** `mkdir companion` and write configs, **copying from `frontend/`** where the file already exists there: `tailwind.config.ts` (same tokens/fonts; adjust `content` paths), `postcss.config.js`, `tsconfig*` (same strictness), `components.json`. Copy `frontend/src/index.css` theme blocks (the `:root` HSL variables, grain/bevel utilities, font-face imports via `@fontsource`) — same vintage-instrument-panel look. Copy the seven shadcn components **verbatim** from `frontend/src/components/ui/` plus `frontend/src/lib/utils.ts` (`cn`).

- [ ] **Step 2:** `package.json` — dependencies: `react`, `react-dom`, `fflate`, `@dnd-kit/core`, `@dnd-kit/sortable`, the same `@fontsource/*` trio, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, and the Radix packages the seven copied components import (check their imports: dialog, scroll-area, separator, slot). devDependencies mirror `frontend/` versions plus `vite-plugin-pwa`. Scripts: `dev`, `build: tsc -b && vite build`, `test: vitest run`, `preview`.

- [ ] **Step 3:** `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // the whole shell precaches: fonts included, so airplane mode has
      // every byte it needs after one visit
      workbox: { globPatterns: ["**/*.{js,css,html,woff2,svg,png}"],
                 maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      manifest: {
        name: "Flightcase", short_name: "Flightcase",
        display: "standalone", background_color: "#12100e",
        theme_color: "#12100e", start_url: ".",
        icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "icon-512.png", sizes: "512x512", type: "image/png" }],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

`index.html` gets `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, `viewport-fit=cover`, and an `apple-touch-icon` link. Generate simple 192/512 PNG icons (phosphor-green "FC" glyph on near-black — a small script or hand-built canvas dump is fine).

- [ ] **Step 4:** `App.tsx` renders the screen switch with placeholder Import screen content; `main.tsx` mounts it plus `<Toaster/>` from sonner. Add one smoke vitest (`src/lib/smoke.test.ts`, mirrors frontend's).

- [ ] **Step 5:** `README.md`: what it is, `bun install && bun run build`, deploy note — static `dist/` to any HTTPS host (Cloudflare Pages: `bun run build`, publish `companion/dist`); HTTPS needed only at install time; the app never phones home after the shell caches.

- [ ] **Step 6:** `cd companion && bun install && bun run build && bun run test` → pass. Commit — `git commit -m "feat(companion): Flightcase app scaffold — Vite/PWA/shadcn shell"`

---

### Task 6: companion core libs (pure logic) + vitest

**Files:**
- Create: `companion/src/lib/types.ts`, `manifest.ts`, `cueStore.ts`, `waveMath.ts`, `cuesExport.ts`, `idb.ts`, `opfs.ts`
- Test: `companion/src/lib/{manifest,cueStore,waveMath,cuesExport}.test.ts`

**Interfaces (later tasks consume all of these — exact names):**

```ts
// types.ts
export type TrackMeta = { id: string; title: string; artist: string;
  bpm: number | null; key_name: string; camelot: string; genre: string;
  duration: number | null; audio: string; peaks: string; peaks_rate: number };
export type Manifest = { schema: 1; set: string; name: string;
  created_at: string; order: string[]; tracks: TrackMeta[] };
export type Cue = { num: number; name: string; start: number; end: number | null };
export type TrackCues = Record<string, Cue[]>;   // trackId -> cues

// manifest.ts — throws Error with a reason on any shape violation
export function parseManifest(json: unknown): Manifest;

// cueStore.ts — pure reducer; invariants enforced: num 0..7, one cue per
// slot, start >= 0 (clamped), end === null or end > start (setLoopEnd with
// end <= start is ignored). Every action returns a NEW array.
export type CueAction =
  | { type: "place"; num: number; start: number }
  | { type: "move"; num: number; start: number }     // keeps loop length
  | { type: "clear"; num: number }
  | { type: "rename"; num: number; name: string }
  | { type: "setLoopEnd"; num: number; end: number | null };  // null = back to point cue
export function cueReducer(cues: Cue[], action: CueAction): Cue[];

// waveMath.ts — view = {start, end} in seconds (zoom window)
export function timeAtX(x: number, width: number, view: {start: number; end: number}): number;
export function xAtTime(t: number, width: number, view: {start: number; end: number}): number;
/** peak byte indices covering one canvas pixel column; returns the max */
export function peakAtColumn(peaks: Uint8Array, rate: number, col: number,
  width: number, view: {start: number; end: number}): number;
export function clampView(view: {start: number; end: number},
  duration: number, minSpan?: number): {start: number; end: number};

// cuesExport.ts
export function buildCuesJson(setStem: string, order: string[],
  cues: TrackCues, now: Date): string;  // JSON text matching the spec's cues.json

// idb.ts — one DB "flightcase", stores: "sets" (key: stem) holding
// {stem, name, manifest, order, importedAt}, and "cues" (key: stem)
// holding TrackCues. Promise API:
export const db: {
  putSet(s: StoredSet): Promise<void>; getSet(stem: string): Promise<StoredSet | undefined>;
  listSets(): Promise<StoredSet[]>; deleteSet(stem: string): Promise<void>;
  putCues(stem: string, cues: TrackCues): Promise<void>;
  getCues(stem: string): Promise<TrackCues>;
  putPeaks(stem: string, trackId: string, peaks: Uint8Array): Promise<void>;
  getPeaks(stem: string, trackId: string): Promise<Uint8Array | undefined>;
};

// opfs.ts
export function audioDir(stem: string): Promise<FileSystemDirectoryHandle>; // creates
export function writeAudio(stem: string, name: string, data: Uint8Array): Promise<void>;
export function readAudioBlob(stem: string, name: string): Promise<Blob>;  // via getFile()
export function deleteSetAudio(stem: string): Promise<void>;
export function storageEstimate(): Promise<{usage: number; quota: number}>;
```

- [ ] **Step 1: Failing vitest for the pure modules.** Cover: manifest accept/reject (wrong schema, missing tracks, non-string id); cueReducer — place into empty slot, place over occupied slot replaces, move preserves loop length (`end - start` constant), clear removes, setLoopEnd rejects `end <= start` (state unchanged), setLoopEnd null converts loop→point, rename, start clamped at 0; waveMath — round-trip `timeAtX(xAtTime(t)) ≈ t`, zoomed view maps correctly, `peakAtColumn` picks the max byte of its span, `clampView` pins to `[0, duration]` and enforces `minSpan`; buildCuesJson — output parses, matches spec shape (`schema:1`, `order`, per-track sorted-by-num cues, `end: null` for point cues), deterministic given `now`.
- [ ] **Step 2:** Run `bun run test` → new tests FAIL.
- [ ] **Step 3:** Implement the seven modules. `idb.ts` and `opfs.ts` are thin promise wrappers (no tests — they're the browser boundary; keep them free of logic). All cue/waveform/manifest logic stays in the pure tested modules.
- [ ] **Step 4:** `bun run test` → PASS. `bun run build` → clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(companion): core data layer — manifest, cue store, wave math, idb/opfs"`

---

### Task 7: Import screen + bundle unzip pipeline

**Files:**
- Create: `companion/src/lib/importBundle.ts`, `companion/src/screens/ImportScreen.tsx`
- Modify: `companion/src/App.tsx`
- Test: extend `companion/src/lib/manifest.test.ts` if importBundle grows parseable logic; the browser pipeline itself is not unit-tested.

**Interfaces:**
- Consumes: `parseManifest`, `db.*`, `opfs.*` from Task 6; `fflate`.
- Produces: `importBundle(file: File, onProgress: (done: number, total: number, label: string) => void): Promise<StoredSet>` — throws `Error` with a user-readable reason; on any failure it deletes whatever it partially wrote (OPFS dir + IDB rows) before rethrowing.

- [ ] **Step 1: Implement `importBundle.ts`.** Use `fflate.Unzip` streaming API over `file.stream()` so a several-hundred-MB zip never fully buffers: read `manifest.json` first (it's small; buffer entries until found if ordering is unfriendly — simplest robust approach: first pass with central-directory via `unzipSync` is NOT acceptable for memory; instead stream entries, holding back audio writes until the manifest has been seen, or do two passes over the File — pass 1 stream-scan for `manifest.json` only, pass 2 stream audio/peaks straight to OPFS). Validate with `parseManifest` **before** writing anything. Peaks → `db.putPeaks`; audio → `opfs.writeAudio`; then `db.putCues(stem, {})` if absent (never clobber existing cues for the same stem — re-import keeps her work) and `db.putSet` last, so a set only lists once fully imported. Wrap `QuotaExceededError`: clean up partial writes, then throw `Error("Not enough space: this bundle needs ~<size>; free up storage and re-import")` using `file.size` and `storageEstimate()`.
- [ ] **Step 2: ImportScreen.** shadcn `Card` layout: a big touch-friendly file input (`accept=".crate,.zip"`), progress (per-file label + count from `onProgress`), error state showing the thrown reason by bundle name, success → navigate to Set screen. On mount: `navigator.storage?.persist?.()` — if the promise resolves false or the API is missing, render a persistent amber warning strip: "iOS may evict imported audio under disk pressure. Keep the .crate in Files; cues are always safe." List already-imported sets (`db.listSets()`) with track counts and a delete action (`deleteSetAudio` + IDB rows; **confirm via shadcn Dialog**, and warn it does not delete cues… actually deleting a set deletes its cues too — say so in the dialog).
- [ ] **Step 3:** Wire into `App.tsx` as the default screen when no sets exist; otherwise default to Set screen with an "Import" button back.
- [ ] **Step 4:** `bun run build && bun run test` pass. Manual sanity in dev server is allowed but not required for the task gate.
- [ ] **Step 5: Commit** — `git commit -m "feat(companion): bundle import — streaming unzip to OPFS, quota-safe"`

---

### Task 8: Set screen — track list, reorder, export cues

**Files:**
- Create: `companion/src/screens/SetScreen.tsx`
- Modify: `companion/src/App.tsx`
- Test: reorder persistence logic, if extracted, joins the pure-lib tests (e.g. `arrayMove` comes from `@dnd-kit/sortable` — no need to retest the library).

**Interfaces:**
- Consumes: `db.getSet/putSet/getCues`, `buildCuesJson`, `@dnd-kit/sortable`.
- Produces: navigation to `{name:"track", trackId}` on row tap.

- [ ] **Step 1:** Track rows in stored `order`: title, artist, BPM (mono font), camelot badge, duration (`m:ss`), cue count LED-style chip (count > 0 lights phosphor green). Rows are `useSortable` items with a drag handle ≥44px; on drop, write the new order back via `db.putSet`. Tap anywhere else on the row → Track screen.
- [ ] **Step 2:** Header: set name, track count, total runtime; an always-visible **Export cues** button: `buildCuesJson(stem, order, await db.getCues(stem), new Date())` → try `navigator.share({files: [new File([json], `${stem} cues.json`, {type: "application/json"})]})`; if `share`/`canShare` unavailable or throws (not user-cancel), fall back to object-URL download. Also an "Import" nav button back to ImportScreen.
- [ ] **Step 3:** Empty-cues export is still valid (order alone is useful); no gating.
- [ ] **Step 4:** `bun run build && bun run test` pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(companion): set screen — reorder + cues export"`

---

### Task 9: Track screen — waveform, transport, cue pads, loops

**Files:**
- Create: `companion/src/screens/TrackScreen.tsx`, `companion/src/components/Waveform.tsx`, `companion/src/components/CuePads.tsx`, `companion/src/components/Transport.tsx`
- Modify: `companion/src/App.tsx`
- Test: any new pure math (e.g. pinch-zoom window arithmetic) goes into `waveMath.ts` + tests; components themselves are not unit-tested.

**Interfaces:**
- Consumes: everything from Task 6; `readAudioBlob` for the `<audio src>` object URL (revoke on unmount).

**Behavior contract (each bullet is a requirement):**

- [ ] **Waveform** (`<canvas>`, devicePixelRatio-aware): draws from the stored `Uint8Array` peaks via `peakAtColumn` per pixel column — mirrored bars, phosphor green, played region brighter, playhead line VFD amber. Cue markers: labeled flags A–H at `xAtTime(cue.start)`; loops render a translucent span start→end.
- [ ] **Tap** on the waveform seeks (`audio.currentTime = timeAtX(...)`). **Placing a cue** is pad-driven: tapping an **empty pad** places that slot at the current playhead; the waveform tap itself never creates cues (accidental cue placement while scrubbing would be worse than one extra tap). Dragging a marker flag nudges its cue (`move` action). All hit targets ≥44px.
- [ ] **Pinch/zoom:** two-pointer pinch on the canvas adjusts the view window through `clampView` (minSpan 2s); a zoom-out button resets to full track. Horizontal one-finger drag when zoomed pans the view. Use Pointer Events, not touch events.
- [ ] **Pads** (`CuePads`): grid of 8 (A–H), 2×4 on iPhone portrait, 1×8 wide on iPad. Filled pad: tap = jump playhead to cue (and if loop, arm it); **swipe horizontally across a pad = clear** (reducer `clear`); **long-press (500ms) opens a shadcn Dialog**: rename (Input), "Set loop end at playhead" / "Remove loop end", delete. Empty pad: tap places at playhead.
- [ ] **Loops:** when a loop cue is armed and `currentTime >= end`, wrap to `start` on a `requestAnimationFrame` watcher (never `timeupdate`). Arming/disarming: tapping the loop's pad toggles.
- [ ] **Transport:** play/pause (big, center), current time / duration in mono, ±10ms nudge buttons for fine placement while paused, BPM + key readout. `<audio>` element hidden, driven by refs.
- [ ] **Persistence:** every reducer dispatch immediately writes through `db.putCues` (debounce ≤ 250ms is acceptable; flush on `visibilitychange`→hidden and on unmount).
- [ ] `prefers-reduced-motion` disables the playhead animation smoothing (jump per frame is fine — the kill-switch is for decorative motion, keep it consistent with Crate's convention in `index.css`).
- [ ] **Steps:** implement → `bun run build && bun run test` pass → commit `git commit -m "feat(companion): track screen — waveform, pads, loops"`.

---

### Task 10: Final integration pass

- [ ] **Whole-branch review** (superpowers:requesting-code-review) against the spec; dispatch one fix subagent with the complete findings list if any.
- [ ] Full gates: `uv run pytest tests/` · `cd frontend && bun run build && bun run test` · `cd companion && bun install && bun run build && bun run test`.
- [ ] File follow-ups: on-device `navigator.storage.persist()` check on the actual iPad; real-iPad AirDrop round-trip QA; deferred `DjmdCue` direct-write idea.
- [ ] Merge to `master`, push (mandatory session workflow).

## Execution notes

- Branch: `flightcase`, from `master`.
- Implementers dispatch **sequentially, one at a time** (project rule); reviewers may run in parallel with the next implementer; whole-branch review at the end.
- Never haiku subagents; opus mostly, sonnet for the most mechanical tasks.
- `bd` (beads) binary is not on PATH on this machine this session — tracked follow-ups land in the plan/commits; sync to beads when `bd` is available again.

## Post-merge follow-ups (bd binary unavailable this session — sync to beads when it returns)

- **On-device iPad pass (the one thing no review could supply):** `navigator.storage.persist()` grant behavior on a home-screen PWA, share-sheet cues export, AirDrop round-trip with a real bundle, gesture feel (pinch/long-press/swipe thresholds), playback of OPFS blob URLs in standalone Safari.
- Deploy `companion/dist` to a static HTTPS host (Cloudflare Pages) and install on Helen's devices.
- Deferred from spec: writing `DjmdCue` rows directly into master.db — only after the XML round trip is proven in practice.
- Hardening follow-ups from reviews (all Minor): parse_cues duplicate-track-id / NaN / bool-slot rejection; bundle.build temp+rename atomicity + TimeoutExpired→ValueError; bundles/ TTL cleanup; djBundle error-path test; .woff dead weight in companion dist; App boot-to-Set-when-sets-exist; same-name overwrite residual on failed re-import.
- Pre-existing test failures (not this feature): 5 live-Spotify genre-drift tests, test_progress_names_failed_track, test_youtube genre drift.
