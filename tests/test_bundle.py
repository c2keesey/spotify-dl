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
        # manifest.json must be the FIRST entry so the importer's pass 1 can
        # stop after the file prefix instead of buffering the whole bundle.
        assert z.namelist()[0] == "manifest.json"
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
