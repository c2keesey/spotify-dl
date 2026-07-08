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
