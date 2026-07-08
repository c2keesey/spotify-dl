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
