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
