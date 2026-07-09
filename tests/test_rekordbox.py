"""Tests for the rekordbox layer. Pure logic (dedup, normalization) tests run
everywhere; anything touching the live DB is guarded and read-only."""

import os
import shutil
import subprocess

import pytest

from spotify_dl import rekordbox as rb

FFMPEG = shutil.which("ffmpeg")


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


# ---- duplicate grouping (collection-vs-itself) ----

def REC(id, path="/lib/a.mp3", artist="Artist", title="Song", duration=200.0):
    """A normalized collection record as load_tracks() produces (the fields
    group_duplicates reads: id, file_path, artist, title, duration)."""
    return {"id": str(id), "file_path": path, "artist": artist, "title": title,
            "duration": duration, "file_state": rb.file_state(path)}


def test_group_exact_path_duplicates():
    # Two rows pointing at the identical absolute file → a certain (exact) dup.
    # REC(3) is the SAME song at a different path, so it is also a fuzzy sibling
    # and must not be swallowed by the exact group.
    groups = rb.group_duplicates([
        REC(1, path="/lib/a.mp3"),
        REC(2, path="/lib/a.mp3"),
        REC(3, path="/lib/b.mp3"),
    ])
    exact = [g for g in groups if g["reason"] == "exact_path"]
    fuzzy = [g for g in groups if g["reason"] == "fuzzy"]
    assert len(exact) == 1
    assert exact[0]["compared"]["file_path"] == "/lib/a.mp3"
    assert {t["id"] for t in exact[0]["tracks"]} == {"1", "2"}
    assert len(fuzzy) == 1
    assert {t["file_path"] for t in fuzzy[0]["tracks"]} == {"/lib/a.mp3", "/lib/b.mp3"}


def test_group_fuzzy_same_song_different_paths():
    # The sync-copy case: same song copied into two folders → different paths,
    # matched on the DB's own artist/title/duration.
    groups = rb.group_duplicates([
        REC(1, path="/lib/house/song.mp3", title="Song (feat. Guest)", duration=201.0),
        REC(2, path="/lib/faves/song.mp3", title="Song", duration=200.0),
    ])
    assert len(groups) == 1
    g = groups[0]
    assert g["reason"] == "fuzzy"
    assert {t["id"] for t in g["tracks"]} == {"1", "2"}
    assert "artist" in g["compared"] and "title" in g["compared"]
    assert "duration" in g["compared"]


def test_group_fuzzy_three_copies():
    groups = rb.group_duplicates([
        REC(1, path="/lib/a/x.mp3"),
        REC(2, path="/lib/b/x.mp3"),
        REC(3, path="/lib/c/x.mp3"),
    ])
    assert len(groups) == 1
    assert groups[0]["reason"] == "fuzzy"
    assert len(groups[0]["tracks"]) == 3


def test_group_uses_db_metadata_never_reads_tags(monkeypatch):
    # 926 of 1437 files are missing on disk and cannot be tag-read. Grouping must
    # rely on the DB's title/artist/duration, NEVER on file_tags — so even if
    # every file is gone (and file_tags would blow up), grouping still works.
    def explode(_p):
        raise AssertionError("group_duplicates must not read ID3 tags")
    monkeypatch.setattr(rb, "file_tags", explode)
    groups = rb.group_duplicates([
        REC(1, path="/gone/a/x.mp3"),   # missing files
        REC(2, path="/gone/b/x.mp3"),
    ])
    assert len(groups) == 1 and groups[0]["reason"] == "fuzzy"


def test_group_excludes_non_file_entries():
    # spotify:track: URIs are streaming pointers, not "the same file at two
    # paths" — they must never be grouped as duplicates, even if identical.
    groups = rb.group_duplicates([
        REC(1, path="spotify:track:abc", title="Song"),
        REC(2, path="spotify:track:abc", title="Song"),
        REC(3, path="", title="Song"),
    ])
    assert groups == []


def test_group_different_songs_same_title_word_not_merged():
    groups = rb.group_duplicates([
        REC(1, path="/lib/a.mp3", title="Song", artist="Artist"),
        REC(2, path="/lib/b.mp3", title="Song (Club Remix)", artist="Artist"),
    ])
    assert groups == []


def test_group_exact_not_double_reported_as_fuzzy():
    # A path referenced twice is an exact dup; it must appear once (exact), not
    # also show up in a fuzzy group.
    groups = rb.group_duplicates([
        REC(1, path="/lib/a.mp3", title="Song"),
        REC(2, path="/lib/a.mp3", title="Song"),
    ])
    assert len(groups) == 1 and groups[0]["reason"] == "exact_path"


def test_group_empty_collection():
    assert rb.group_duplicates([]) == []


# ---- file_tags (against real mp3 files) ----

@pytest.fixture
def make_mp3(tmp_path):
    """Encode a tiny real silent mp3 (so mutagen can read info.length) and
    optionally write EasyID3 artist/title tags."""
    def _make(name="track.mp3", seconds=1.0, artist=None, title=None):
        path = tmp_path / name
        subprocess.run(
            [FFMPEG, "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
             "-t", str(seconds), "-q:a", "9", str(path)],
            capture_output=True, check=True,
        )
        if artist is not None or title is not None:
            from mutagen.easyid3 import EasyID3
            from mutagen.id3 import ID3NoHeaderError
            try:
                audio = EasyID3(str(path))
            except ID3NoHeaderError:
                audio = EasyID3()
            if artist is not None:
                audio["artist"] = artist
            if title is not None:
                audio["title"] = title
            audio.save(str(path))
        return path
    return _make


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg required to encode a test mp3")
def test_file_tags_reads_id3(make_mp3):
    p = make_mp3(artist="KAYTRANADA", title="Intimidated", seconds=1.0)
    artist, title, dur = rb.file_tags(str(p))
    assert artist == "KAYTRANADA"
    assert title == "Intimidated"
    assert dur is not None and 0.5 < dur < 3.0


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg required to encode a test mp3")
def test_file_tags_falls_back_to_stem_when_title_absent(make_mp3):
    # tags exist (artist set) but no title -> title comes from the filename stem
    p = make_mp3(name="Cool Track.mp3", artist="Someone", seconds=1.0)
    artist, title, dur = rb.file_tags(str(p))
    assert artist == "Someone"
    assert title == "Cool Track"
    assert dur is not None and dur > 0.5


def test_file_tags_unreadable_file_returns_stem_and_none(tmp_path):
    p = tmp_path / "not-audio.mp3"
    p.write_text("this is definitely not an mp3")
    assert rb.file_tags(str(p)) == ("", "not-audio", None)


# ---- read layer (record shaping is pure; live read is guarded) ----

from pathlib import Path


class FakeKey:
    def __init__(self, name):
        self.ScaleName = name


class FakeArtist:
    def __init__(self, name):
        self.Name = name


class FakeGenre:
    def __init__(self, name):
        self.Name = name


class FakeContent:
    def __init__(self, id=1, title="Song", artist="Artist", bpm=12400,
                 key="Am", path="/lib/a.mp3", length=200, genre="House"):
        self.ID = id
        self.Title = title
        self.Artist = FakeArtist(artist) if artist else None
        self.BPM = bpm
        self.Key = FakeKey(key) if key else None
        self.Genre = FakeGenre(genre) if genre else None
        self.FolderPath = path
        self.Length = length


def test_record_analyzed_track(monkeypatch):
    monkeypatch.setattr(rb, "_cached_file_state", lambda p: "missing")
    r = rb._record(FakeContent())
    assert r == {
        "id": "1", "title": "Song", "artist": "Artist", "bpm": 124.0,
        "key_name": "Am", "camelot": "8A", "file_path": "/lib/a.mp3",
        "duration": 200, "status": "analyzed", "genre": "House",
        "file_state": "missing",
    }


def test_record_pending_when_unanalyzed():
    r = rb._record(FakeContent(bpm=0, key=None))
    assert r["status"] == "pending"
    assert r["bpm"] is None and r["camelot"] is None


def test_record_falls_back_to_filename():
    r = rb._record(FakeContent(title=None, artist=None, path="/lib/Cool Track.mp3"))
    assert r["title"] == "Cool Track" and r["artist"] == ""


def test_record_genre_present_and_absent():
    assert rb._record(FakeContent(genre="Techno"))["genre"] == "Techno"
    assert rb._record(FakeContent(genre=None))["genre"] is None


# ---- file_state ----

def test_file_state_present(tmp_path):
    f = tmp_path / "there.mp3"
    f.write_text("x")
    assert rb.file_state(str(f)) == "present"


def test_file_state_missing(tmp_path):
    # real absolute path, its volume (/) is present, but the file is not there
    assert rb.file_state(str(tmp_path / "gone.mp3")) == "missing"


def test_file_state_not_a_file():
    assert rb.file_state("spotify:track:4uLU6hMCjMI75M1A2tKUQC") == "not_a_file"
    assert rb.file_state("") == "not_a_file"
    assert rb.file_state("relative/path.mp3") == "not_a_file"


def test_file_state_unmounted_volume():
    # a /Volumes/<name> whose root is not mounted must read "unmounted",
    # never "missing" — a whole disconnected drive is not a missing file.
    path = "/Volumes/NoSuchDrive_test_xyz/Music/track.mp3"
    assert rb.file_state(path) == "unmounted"


# ---- presence cache ----

def test_presence_cache_avoids_second_stat(monkeypatch):
    rb._PRESENCE_CACHE.clear()
    calls = []
    monkeypatch.setattr(rb, "file_state", lambda p: calls.append(p) or "present")
    assert rb._cached_file_state("/lib/x.mp3") == "present"
    assert rb._cached_file_state("/lib/x.mp3") == "present"
    assert calls == ["/lib/x.mp3"]                 # second call served from cache


def test_presence_cache_expires_after_ttl(monkeypatch):
    rb._PRESENCE_CACHE.clear()
    calls = []
    monkeypatch.setattr(rb, "file_state", lambda p: calls.append(p) or "present")
    t = [1000.0]
    monkeypatch.setattr(rb.time, "monotonic", lambda: t[0])
    rb._cached_file_state("/lib/x.mp3")
    t[0] += rb._PRESENCE_TTL + 1                    # jump past the TTL
    rb._cached_file_state("/lib/x.mp3")
    assert calls == ["/lib/x.mp3", "/lib/x.mp3"]    # re-stated after expiry


def test_backup_master_db(tmp_path, monkeypatch):
    src = tmp_path / "master.db"
    src.write_bytes(b"db-bytes")
    monkeypatch.setattr(rb, "MASTER_DB", src)
    dest = rb.backup_master_db()
    assert dest.exists() and dest.read_bytes() == b"db-bytes"
    assert dest.name.startswith("master.backup.spotify-dl.")
    assert dest.parent == src.parent


def test_backup_master_db_names_are_unique(tmp_path, monkeypatch):
    """Two back-to-back backups must not collide — sub-second precision + pid
    keep the filenames distinct (a whole-second stamp collided under rapid
    successive writes)."""
    src = tmp_path / "master.db"
    src.write_bytes(b"db-bytes")
    monkeypatch.setattr(rb, "MASTER_DB", src)
    d1 = rb.backup_master_db()
    d2 = rb.backup_master_db()
    assert d1 != d2
    assert d1.exists() and d2.exists()
    assert str(os.getpid()) in d1.name


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


def test_import_dedups_within_batch(stub_writes):
    fake, backups = stub_writes
    # stub file_tags returns the same song for every path -> second is an intra-batch dupe
    result = rb.import_files(["/d/copy1.mp3", "/d/copy2.mp3"])
    assert result["imported"] == ["/d/copy1.mp3"]
    assert len(result["skipped_duplicates"]) == 1
    assert [a[0] for a in fake.added] == ["/d/copy1.mp3"]


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
        # export validates ids against the collection first
        monkeypatch.setattr(rb, "load_tracks",
                            lambda: [{"id": "10"}, {"id": "20"}, {"id": "30"}])
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


def test_export_rejects_unknown_ids(stub_export, monkeypatch):
    """An id that isn't in the collection is refused BEFORE any write — no
    backup, no playlist creation."""
    fake = stub_export()
    monkeypatch.setattr(rb, "load_tracks", lambda: [{"id": "10"}])
    with pytest.raises(ValueError):
        rb.export_playlist("Set", ["10", "999"])
    assert fake.created == [] and not fake.committed


def test_export_rejects_empty(stub_export):
    with pytest.raises(ValueError):
        rb.export_playlist("X", [])


def _rec(id, path, title="Song", artist="Artist", duration=200):
    return {"id": id, "file_path": path, "title": title,
            "artist": artist, "duration": duration}


def test_group_exact_dup_does_not_hide_its_fuzzy_sibling():
    """Two rows at /a.mp3 (exact) plus one same-song copy at /b.mp3. The /b.mp3
    copy must still surface — excluding exact paths from the fuzzy pass would
    leave it a singleton and drop it entirely."""
    records = [_rec("1", "/lib/a.mp3"), _rec("2", "/lib/a.mp3"), _rec("3", "/lib/b.mp3")]
    groups = rb.group_duplicates(records)
    exact = [g for g in groups if g["reason"] == "exact_path"]
    fuzzy = [g for g in groups if g["reason"] == "fuzzy"]
    assert len(exact) == 1 and {t["id"] for t in exact[0]["tracks"]} == {"1", "2"}
    assert len(fuzzy) == 1, "the /b.mp3 copy must appear in a fuzzy group"
    paths = {t["file_path"] for t in fuzzy[0]["tracks"]}
    assert paths == {"/lib/a.mp3", "/lib/b.mp3"}


def test_group_exact_dup_alone_is_not_also_reported_as_fuzzy():
    """A pure exact duplicate (no other copies) collapses to one representative,
    so it never doubles as a fuzzy group."""
    groups = rb.group_duplicates([_rec("1", "/lib/a.mp3"), _rec("2", "/lib/a.mp3")])
    assert [g["reason"] for g in groups] == ["exact_path"]


def test_load_tracks_is_memoized_and_invalidated_by_writes(monkeypatch):
    calls = []

    def fake_read():
        calls.append(1)
        return [{"id": "1"}]

    monkeypatch.setattr(rb, "_read_tracks", fake_read)
    rb.invalidate_tracks_cache()
    rb.load_tracks()
    rb.load_tracks()
    assert len(calls) == 1, "second read inside the TTL must hit the cache"
    rb.invalidate_tracks_cache()
    rb.load_tracks()
    assert len(calls) == 2, "an explicit invalidation must force a re-read"
