"""Tests for pure DJ math: Camelot mapping, compatibility, energy parsing."""

import threading

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


def test_energy_cache_concurrent_writes_preserved(tmp_path, monkeypatch):
    """Two threads computing energy for different files must not clobber each
    other's cache entry (non-atomic read-modify-write race)."""
    cache = tmp_path / "energy.json"
    songs = []
    for name in ("a.mp3", "b.mp3"):
        s = tmp_path / name
        s.write_bytes(b"x")
        songs.append(s)

    class FakeDone:
        stderr = FFMPEG_EBUR128_TAIL

    start = threading.Barrier(2)

    def fake_run(cmd, **kw):
        start.wait()          # maximize overlap: both threads run at once
        return FakeDone()

    monkeypatch.setattr(dj.subprocess, "run", fake_run)

    def worker(song):
        dj.get_energy(str(song), cache_file=cache)

    threads = [threading.Thread(target=worker, args=(s,)) for s in songs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    saved = dj._load_energy_cache(cache)
    keys = {k.split(":")[0] for k in saved}
    assert keys == {str(songs[0]), str(songs[1])}   # both entries survived


def test_load_energy_cache_non_dict(tmp_path, monkeypatch):
    """A cache file that isn't a JSON object must not break get_energy."""
    cache = tmp_path / "energy.json"
    cache.write_text("[1,2]")
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")

    class FakeDone:
        stderr = FFMPEG_EBUR128_TAIL

    monkeypatch.setattr(dj.subprocess, "run", lambda cmd, **kw: FakeDone())
    assert dj.get_energy(str(song), cache_file=cache) == -9.8


# ---- measure_energy: state reporting ----

class _FakeDone:
    def __init__(self, stderr):
        self.stderr = stderr


def test_measure_energy_measured(tmp_path, monkeypatch):
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")
    cache = tmp_path / "energy.json"
    monkeypatch.setattr(dj.subprocess, "run",
                        lambda cmd, **kw: _FakeDone(FFMPEG_EBUR128_TAIL))
    assert dj.measure_energy(str(song), cache_file=cache) == {
        "lufs": -9.8, "state": "measured"}


def test_measure_energy_missing(tmp_path):
    assert dj.measure_energy(str(tmp_path / "gone.mp3"),
                             cache_file=tmp_path / "c.json") == {
        "lufs": None, "state": "missing"}


def test_measure_energy_not_a_file(tmp_path):
    # a spotify: URI is not an absolute path -> missing, never a crash
    assert dj.measure_energy("spotify:track:abc",
                             cache_file=tmp_path / "c.json") == {
        "lufs": None, "state": "missing"}


def test_measure_energy_failed_ffmpeg_error(tmp_path, monkeypatch):
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")

    def boom(cmd, **kw):
        raise OSError("ffmpeg not installed")

    monkeypatch.setattr(dj.subprocess, "run", boom)
    assert dj.measure_energy(str(song), cache_file=tmp_path / "c.json") == {
        "lufs": None, "state": "failed"}


def test_measure_energy_failed_parse(tmp_path, monkeypatch):
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")
    monkeypatch.setattr(dj.subprocess, "run",
                        lambda cmd, **kw: _FakeDone("garbage, no summary"))
    assert dj.measure_energy(str(song), cache_file=tmp_path / "c.json") == {
        "lufs": None, "state": "failed"}


def test_measure_energy_failed_not_cached(tmp_path, monkeypatch):
    """A failed measurement must never be written to the on-disk cache — the
    file may reappear or ffmpeg may be installed later."""
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")
    cache = tmp_path / "energy.json"
    monkeypatch.setattr(dj.subprocess, "run",
                        lambda cmd, **kw: _FakeDone("no summary"))
    dj.measure_energy(str(song), cache_file=cache)
    assert dj._load_energy_cache(cache) == {}


def test_measure_energy_uses_cache_without_ffmpeg(tmp_path, monkeypatch):
    song = tmp_path / "a.mp3"
    song.write_bytes(b"x")
    cache = tmp_path / "energy.json"
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return _FakeDone(FFMPEG_EBUR128_TAIL)

    monkeypatch.setattr(dj.subprocess, "run", fake_run)
    assert dj.measure_energy(str(song), cache_file=cache)["state"] == "measured"
    second = dj.measure_energy(str(song), cache_file=cache)
    assert second == {"lufs": -9.8, "state": "measured"}
    assert len(calls) == 1   # cached hit, ffmpeg not re-invoked
