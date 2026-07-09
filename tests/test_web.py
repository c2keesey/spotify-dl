"""Tests for the web UI layer (spotify_dl/web.py).

No network, no real downloads: subprocess, crontab, and the Spotify client are
all mocked. Run with `pytest tests/test_web.py`.
"""

import pytest
from fastapi.testclient import TestClient
from spotipy.exceptions import SpotifyException

from spotify_dl import web

# Captured before any test can stub it: auto_import writes to the real
# rekordbox DB when rekordbox is closed, so tests that need the REAL function
# (not the autouse stub below) reach for this handle.
REAL_AUTO_IMPORT = web.auto_import


@pytest.fixture(autouse=True)
def _no_real_auto_import(monkeypatch):
    """auto_import writes to the real rekordbox DB when rekordbox is closed —
    never let a test reach it. Tests that need it use REAL_AUTO_IMPORT."""
    monkeypatch.setattr(web, "auto_import", lambda output, files=None: None)


@pytest.fixture
def client():
    web.jobs.clear()
    web._NOT_IMPORTED_CACHE.clear()
    return TestClient(web.app)


# ---- error summarization ----

def test_summarize_editorial_playlist():
    log = [
        "HTTP Error for GET to https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGoYBM5M",
        "404 due to Resource not found",
    ]
    assert "editorial" in web.summarize_error(log).lower()


def test_summarize_generic_404():
    msg = web.summarize_error(["http status: 404", "Resource not found"])
    assert "private" in msg.lower() or "deleted" in msg.lower()


def test_summarize_youtube_block():
    assert "yt-dlp" in web.summarize_error(["Signature solving failed"]).lower()


def test_summarize_fallback_to_last_error_line():
    log = ["Starting", "Traceback (most recent call last):", "ValueError: something broke"]
    assert web.summarize_error(log) == "ValueError: something broke"


def test_summarize_none_when_clean():
    assert web.summarize_error(["all good", "done"]) is None


# ---- preview ----

class FakeSpotify:
    def track(self, _id):
        return {"name": "Blinding Lights", "artists": [{"name": "The Weeknd"}],
                "album": {"images": [{"url": "http://img/track.jpg"}]}}

    def album(self, _id):
        return {"name": "After Hours", "total_tracks": 14, "images": [{"url": "http://img/album.jpg"}]}

    def playlist(self, _id, fields=None):
        return {"name": "My Mix", "images": [{"url": "http://img/pl.jpg"}], "tracks": {"total": 42}}


def test_preview_track(client, monkeypatch):
    monkeypatch.setattr(web, "spotify_client", lambda: FakeSpotify())
    r = client.get("/api/preview", params={"url": "https://open.spotify.com/track/abc123"})
    d = r.json()
    assert d["kind"] == "track" and d["count"] == 1
    assert d["name"] == "The Weeknd — Blinding Lights"
    assert d["error"] is None


def test_preview_playlist(client, monkeypatch):
    monkeypatch.setattr(web, "spotify_client", lambda: FakeSpotify())
    d = client.get("/api/preview", params={"url": "https://open.spotify.com/playlist/xyz"}).json()
    assert d["kind"] == "playlist" and d["count"] == 42 and d["name"] == "My Mix"


def test_preview_editorial_404(client, monkeypatch):
    fake = FakeSpotify()
    fake.playlist = lambda _id, fields=None: (_ for _ in ()).throw(SpotifyException(404, -1, "x"))
    monkeypatch.setattr(web, "spotify_client", lambda: fake)
    d = client.get("/api/preview", params={"url": "https://open.spotify.com/playlist/37i9dQZ"}).json()
    assert "editorial" in d["error"].lower()


def test_preview_missing_credentials(client, monkeypatch):
    def raise_creds():
        raise RuntimeError("missing-credentials")
    monkeypatch.setattr(web, "spotify_client", raise_creds)
    d = client.get("/api/preview", params={"url": "https://open.spotify.com/track/abc"}).json()
    assert ".env" in d["error"]


def test_preview_soundcloud(client):
    d = client.get("/api/preview", params={"url": "https://soundcloud.com/artist/track"}).json()
    assert d["kind"] == "soundcloud" and d["error"] is None


def test_preview_bad_link(client):
    d = client.get("/api/preview", params={"url": "https://example.com/foo"}).json()
    assert d["kind"] is None and d["error"]


# ---- download lifecycle (subprocess mocked) ----

class FakeProc:
    def __init__(self, lines, returncode=0):
        self.stdout = iter(lines)
        self.returncode = returncode

    def wait(self):
        return self.returncode


def test_download_success(client, monkeypatch):
    lines = ["Total songs: 1\n", "Initiating download for The Weeknd - Blinding Lights.\n",
             "[ExtractAudio] Destination: x.mp3\n"]
    monkeypatch.setattr(web.subprocess, "Popen", lambda *a, **k: FakeProc(lines, 0))
    r = client.post("/api/download", json={"urls": ["https://open.spotify.com/track/abc"], "output": ""})
    # run_job runs in a daemon thread; poll the in-memory job until it settles
    job = web.jobs[r.json()["id"]]
    import time
    for _ in range(200):
        if job["status"] != "running":
            break
        time.sleep(0.01)
    assert job["status"] == "done"
    listed = client.get("/api/jobs").json()[0]
    assert listed["progress"]["total"] == 1 and listed["progress"]["done"] == 1
    assert listed["progress"]["failed"] == 0
    assert listed["error"] is None


def test_download_failure_has_error(client, monkeypatch):
    lines = ["Starting", "404 due to Resource not found", "playlists/37i9dQ"]
    monkeypatch.setattr(web.subprocess, "Popen", lambda *a, **k: FakeProc(lines, 1))
    r = client.post("/api/download", json={"urls": ["https://open.spotify.com/playlist/37i9dQ"]})
    job = web.jobs[r.json()["id"]]
    import time
    for _ in range(200):
        if job["status"] != "running":
            break
        time.sleep(0.01)
    assert job["status"] == "failed"
    assert "editorial" in client.get("/api/jobs").json()[0]["error"].lower()


def test_download_rejects_empty(client):
    assert client.post("/api/download", json={"urls": [" ", ""]}).status_code == 400


# ---- failed-track surfacing ----

def test_progress_names_failed_track():
    log = [
        "Total songs: 3",
        "[ExtractAudio] Destination: a.mp3",
        "Failed to download The Beatles - Yesterday, make sure yt_dlp is up to date",
        "No search results found for Obscure Artist - B-side, skipping.   youtube.py:322",
    ]
    p = web.parse_progress(log)
    assert p["total"] == 3 and p["done"] == 1
    assert p["failed"] == 2                       # 3 total - 1 done
    assert "The Beatles - Yesterday" in p["failed_tracks"]
    assert "Obscure Artist - B-side" in p["failed_tracks"]


def test_progress_dedupes_and_counts_unnamed():
    log = [
        "Total songs: 5",
        "[ExtractAudio] Destination: a.mp3",
        "[ExtractAudio] Destination: b.mp3",
        "Failed to download Same Song, make sure yt_dlp is up to date",
        "Failed to download Same Song, make sure yt_dlp is up to date",
    ]
    p = web.parse_progress(log)
    assert p["done"] == 2
    assert p["failed"] == 3                       # 5 - 2; only one named (deduped)
    assert p["failed_tracks"] == ["Same Song"]


# ---- browse & library ----

def test_browse_lists_dirs(client, tmp_path):
    (tmp_path / "alpha").mkdir()
    (tmp_path / "beta").mkdir()
    (tmp_path / ".hidden").mkdir()
    d = client.get("/api/browse", params={"path": str(tmp_path)}).json()
    assert "alpha" in d["dirs"] and "beta" in d["dirs"] and ".hidden" not in d["dirs"]


def test_library_counts_tracks(client, tmp_path):
    mix = tmp_path / "Road Trip"
    mix.mkdir()
    (mix / "song1.mp3").write_text("x")
    (mix / "song2.mp3").write_text("x")
    (tmp_path / "loose.mp3").write_text("x")
    d = client.get("/api/library", params={"path": str(tmp_path)}).json()
    folder = next(f for f in d["folders"] if f["name"] == "Road Trip")
    assert folder["tracks"] == 2 and d["loose"] == 1


def test_reveal_missing_path(client):
    assert client.post("/api/reveal", json={"path": "/no/such/place/xyz"}).status_code == 404


class FakeRun:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def test_pick_folder_returns_chosen_path(client, monkeypatch, tmp_path):
    monkeypatch.setattr(web.sys, "platform", "darwin")
    monkeypatch.setattr(web.subprocess, "run", lambda *a, **k: FakeRun(0, str(tmp_path) + "/\n"))
    d = client.post("/api/pick-folder", json={"start": str(tmp_path)}).json()
    assert d["cancelled"] is False and d["path"] == str(tmp_path)


def test_pick_folder_cancelled(client, monkeypatch):
    monkeypatch.setattr(web.sys, "platform", "darwin")
    monkeypatch.setattr(web.subprocess, "run", lambda *a, **k: FakeRun(1, "", "execution error: User canceled. (-128)"))
    assert client.post("/api/pick-folder", json={}).json() == {"cancelled": True}


def test_pick_folder_non_mac(client, monkeypatch):
    monkeypatch.setattr(web.sys, "platform", "linux")
    assert client.post("/api/pick-folder", json={}).status_code == 501


# ---- crons (crontab mocked) ----

def test_cron_create_list_toggle_delete(client, monkeypatch):
    store = {"lines": []}
    monkeypatch.setattr(web, "_read_crontab", lambda: list(store["lines"]))
    monkeypatch.setattr(web, "_write_crontab", lambda lines: store.update(lines=list(lines)))

    cid = client.post("/api/crons", json={
        "urls": ["https://open.spotify.com/track/abc"], "output": "", "freq": "daily", "hour": 3, "minute": 0,
    }).json()["id"]

    crons = client.get("/api/crons").json()
    assert len(crons) == 1 and crons[0]["managed"] and crons[0]["enabled"]
    assert "Daily" in crons[0]["friendly"]

    assert client.post(f"/api/crons/{cid}/toggle").json()["enabled"] is False
    assert client.get("/api/crons").json()[0]["enabled"] is False

    assert client.delete(f"/api/crons/{cid}").json()["ok"] is True
    assert client.get("/api/crons").json() == []


def test_cron_list_includes_editable_fields(client, monkeypatch):
    store = {"lines": []}
    monkeypatch.setattr(web, "_read_crontab", lambda: list(store["lines"]))
    monkeypatch.setattr(web, "_write_crontab", lambda lines: store.update(lines=list(lines)))
    client.post("/api/crons", json={
        "urls": ["https://open.spotify.com/playlist/abc"], "output": "",
        "freq": "weekly", "hour": 9, "minute": 30, "dow": 5,
    })
    fields = client.get("/api/crons").json()[0]["fields"]
    assert fields == {"freq": "weekly", "hour": 9, "minute": 30, "dow": 5}


def test_cron_update_in_place(client, monkeypatch):
    store = {"lines": []}
    monkeypatch.setattr(web, "_read_crontab", lambda: list(store["lines"]))
    monkeypatch.setattr(web, "_write_crontab", lambda lines: store.update(lines=list(lines)))

    cid = client.post("/api/crons", json={
        "urls": ["https://open.spotify.com/playlist/abc"], "output": "",
        "freq": "daily", "hour": 3, "minute": 0,
    }).json()["id"]

    new_id = client.put(f"/api/crons/{cid}", json={
        "urls": ["https://open.spotify.com/playlist/abc"], "output": "",
        "freq": "daily", "hour": 8, "minute": 15,
    }).json()["id"]

    crons = client.get("/api/crons").json()
    assert len(crons) == 1                       # replaced in place, not duplicated
    assert crons[0]["id"] == new_id
    assert "8:15 AM" in crons[0]["friendly"]


def test_cron_update_preserves_disabled_state(client, monkeypatch):
    store = {"lines": []}
    monkeypatch.setattr(web, "_read_crontab", lambda: list(store["lines"]))
    monkeypatch.setattr(web, "_write_crontab", lambda lines: store.update(lines=list(lines)))
    cid = client.post("/api/crons", json={
        "urls": ["https://open.spotify.com/playlist/abc"], "output": "", "freq": "daily", "hour": 3, "minute": 0,
    }).json()["id"]
    client.post(f"/api/crons/{cid}/toggle")      # disable it
    cid2 = web._cron_id(*web._parse_cron_line(store["lines"][0])[1:])
    new_id = client.put(f"/api/crons/{cid2}", json={
        "urls": ["https://open.spotify.com/playlist/abc"], "output": "", "freq": "daily", "hour": 6, "minute": 0,
    }).json()["id"]
    assert client.get("/api/crons").json()[0]["enabled"] is False
    assert client.get("/api/crons").json()[0]["id"] == new_id


def test_cron_update_missing(client, monkeypatch):
    monkeypatch.setattr(web, "_read_crontab", lambda: [])
    monkeypatch.setattr(web, "_write_crontab", lambda lines: None)
    r = client.put("/api/crons/deadbeef", json={
        "urls": ["https://open.spotify.com/track/x"], "output": "", "freq": "daily", "hour": 3, "minute": 0,
    })
    assert r.status_code == 404


# ---- dj: status & tracks (rekordbox layer stubbed) ----

def DJTRACK(**kw):
    base = {"id": "1", "title": "Song", "artist": "Artist", "bpm": 124.0,
            "key_name": "Am", "camelot": "8A", "file_path": "/lib/a.mp3",
            "duration": 200, "status": "analyzed", "playlists": [],
            "genre": "House", "file_state": "present"}
    base.update(kw)
    return base


def test_dj_status(client, monkeypatch, tmp_path):
    (tmp_path / "new.mp3").write_text("x")
    (tmp_path / "old.mp3").write_text("x")
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: True)
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(file_path=str(tmp_path / "old.mp3")),
        DJTRACK(id="2", status="pending", bpm=None, camelot=None,
                file_state="missing"),
        DJTRACK(id="3", file_state="unmounted"),
        DJTRACK(id="4", file_state="not_a_file"),
    ])
    d = client.get("/api/dj/status", params={"path": str(tmp_path)}).json()
    assert d == {"running": True, "can_write": False,
                 "analyzed": 3, "pending": 1, "not_imported": 1,
                 "missing": 1, "unmounted": 1, "not_a_file": 1}


def test_dj_status_not_imported_honors_fuzzy_dedup(client, monkeypatch, tmp_path):
    """A folder file that is a FUZZY duplicate (same artist/title/duration, a
    different path) of a collection track must not be counted as not_imported —
    the importer would skip it, so the Import button would never clear."""
    (tmp_path / "copy.mp3").write_text("x")     # NOT the collection's path
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: False)
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(file_path="/lib/original.mp3", artist="Artist",
                title="Song", duration=200)])
    # find_duplicates reads the folder file's tags — make them match by song
    monkeypatch.setattr(web.rekordbox, "file_tags",
                        lambda p: ("Artist", "Song", 201.0))
    d = client.get("/api/dj/status", params={"path": str(tmp_path)}).json()
    assert d["not_imported"] == 0


def test_dj_status_not_imported_counts_genuinely_new(client, monkeypatch, tmp_path):
    """A folder file that is NOT a duplicate of anything is still counted."""
    (tmp_path / "brand_new.mp3").write_text("x")
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: False)
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(file_path="/lib/original.mp3", artist="Artist",
                title="Song", duration=200)])
    monkeypatch.setattr(web.rekordbox, "file_tags",
                        lambda p: ("Nobody", "Unheard", 333.0))
    d = client.get("/api/dj/status", params={"path": str(tmp_path)}).json()
    assert d["not_imported"] == 1


def test_dj_tracks_filters(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(),
        DJTRACK(id="2", title="Fast One", bpm=150.0, camelot="9A", genre="Techno"),
        DJTRACK(id="3", title="Other", artist="Someone", bpm=124.0, camelot="8B",
                file_state="missing"),
    ])
    all_ = client.get("/api/dj/tracks").json()["tracks"]
    assert len(all_) == 3
    hits = client.get("/api/dj/tracks", params={"bpm_min": 140}).json()["tracks"]
    assert [t["id"] for t in hits] == ["2"]
    hits = client.get("/api/dj/tracks", params={"camelot": "8B"}).json()["tracks"]
    assert [t["id"] for t in hits] == ["3"]
    hits = client.get("/api/dj/tracks", params={"q": "someone"}).json()["tracks"]
    assert [t["id"] for t in hits] == ["3"]
    hits = client.get("/api/dj/tracks", params={"genre": "Techno"}).json()["tracks"]
    assert [t["id"] for t in hits] == ["2"]
    hits = client.get("/api/dj/tracks", params={"file_state": "missing"}).json()["tracks"]
    assert [t["id"] for t in hits] == ["3"]


def test_dj_tracks_db_error_is_503(client, monkeypatch):
    def boom():
        raise RuntimeError("no db")
    monkeypatch.setattr(web.rekordbox, "load_tracks", boom)
    assert client.get("/api/dj/tracks").status_code == 503


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
        DJTRACK(id="1", file_path="/lib/a.mp3"),
        DJTRACK(id="2", file_path="/lib/gone.mp3")])
    states = {"/lib/a.mp3": {"lufs": -9.8, "state": "measured"},
              "/lib/gone.mp3": {"lufs": None, "state": "missing"}}
    monkeypatch.setattr(web.dj, "measure_energy", lambda path: states[path])
    d = client.post("/api/dj/energy",
                    json={"ids": ["1", "2", "999"]}).json()
    # energy map keeps its exact existing shape: {id: float|None}
    assert d["energy"] == {"1": -9.8, "2": None, "999": None}
    # sibling state map explains why each is what it is
    assert d["state"] == {"1": "measured", "2": "missing", "999": "missing"}


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


def test_dj_export_unknown_ids_is_400(client, monkeypatch):
    """export_playlist validates ids exist in the collection; a ValueError from
    that guard surfaces as a 400, not an unhandled 500."""
    def refuse(name, ids):
        raise ValueError("unknown track ids: 999")
    monkeypatch.setattr(web.rekordbox, "export_playlist", refuse)
    r = client.post("/api/dj/export", json={"name": "Set", "ids": ["999"]})
    assert r.status_code == 400 and "unknown track ids" in r.json()["detail"]


# ---- dj: suggest the next track (read-only; recommends, never auto-adds) ----

def test_dj_suggest_ranks_against_last_slot(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),   # the last (only) slot
        DJTRACK(id="2", camelot="8A", bpm=124.0),   # same key & tempo -> good
        DJTRACK(id="3", camelot="9A", bpm=126.0),   # neighbour, tiny bpm gap -> good
        DJTRACK(id="4", camelot="3B", bpm=90.0),    # distant key -> clash
    ])
    d = client.post("/api/dj/suggest", json={"ids": ["1"]}).json()
    ids = [s["track"]["id"] for s in d["suggestions"]]
    assert ids == ["2", "3", "4"]                   # good, good, clash — clash last
    assert d["suggestions"][0]["rating"] == "good"
    assert d["suggestions"][-1]["rating"] == "clash"


def test_dj_suggest_reports_relation_and_bpm_delta_not_just_a_score(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot="8B", bpm=126.0)])
    s = client.post("/api/dj/suggest", json={"ids": ["1"]}).json()["suggestions"][0]
    assert s["relation"] == "Relative major/minor"   # the harmonic "why"
    assert s["bpm_delta"] == 2.0                       # signed candidate-minus-last, for display


def test_dj_suggest_excludes_set_members(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot="8A", bpm=124.0),
        DJTRACK(id="3", camelot="9A", bpm=126.0),
    ])
    d = client.post("/api/dj/suggest", json={"ids": ["1", "2"]}).json()
    ids = [s["track"]["id"] for s in d["suggestions"]]
    assert ids == ["3"]                              # ranked against last slot "2", members gone


def test_dj_suggest_excludes_unscoreable_tracks(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot=None, key_name=None, bpm=124.0, status="pending"),  # no key
        DJTRACK(id="3", camelot="8A", bpm=None, status="pending"),                  # no bpm
        DJTRACK(id="4", camelot="9A", bpm=126.0),                                   # scoreable
    ])
    d = client.post("/api/dj/suggest", json={"ids": ["1"]}).json()
    assert [s["track"]["id"] for s in d["suggestions"]] == ["4"]


def test_dj_suggest_excludes_streaming_entries(client, monkeypatch):
    # a not_a_file entry has BPM/key in the DB but no local audio to cue -> never suggested
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot="8A", bpm=124.0, file_path="spotify:track:abc",
                file_state="not_a_file"),
        DJTRACK(id="3", camelot="9A", bpm=126.0),
    ])
    d = client.post("/api/dj/suggest", json={"ids": ["1"]}).json()
    assert [s["track"]["id"] for s in d["suggestions"]] == ["3"]


def test_dj_suggest_includes_missing_file_tracks(client, monkeypatch):
    # a moved file (missing) is still a perfectly good suggestion: BPM/key come from the DB
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot="8A", bpm=124.0, file_path="/lib/moved.mp3",
                file_state="missing"),
    ])
    d = client.post("/api/dj/suggest", json={"ids": ["1"]}).json()
    assert [s["track"]["id"] for s in d["suggestions"]] == ["2"]


def test_dj_suggest_empty_set_is_empty(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0)])
    assert client.post("/api/dj/suggest", json={"ids": []}).json() == {"suggestions": []}


def test_dj_suggest_unscoreable_last_slot_is_empty(client, monkeypatch):
    # nothing to rank against when the last slot has no key/bpm -> empty, not garbage
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot=None, key_name=None, bpm=None, status="pending"),
        DJTRACK(id="2", camelot="8A", bpm=124.0)])
    assert client.post("/api/dj/suggest", json={"ids": ["1"]}).json() == {"suggestions": []}


def test_dj_suggest_caps_results(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="0", camelot="8A", bpm=124.0)] + [
        DJTRACK(id=str(i), camelot="8A", bpm=124.0) for i in range(1, 40)])
    d = client.post("/api/dj/suggest", json={"ids": ["0"]}).json()
    assert len(d["suggestions"]) == 20        # sensible cap, not all 39


def test_dj_suggest_never_writes_or_imports(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", camelot="8A", bpm=124.0),
        DJTRACK(id="2", camelot="8A", bpm=124.0)])

    def forbidden(*a, **k):
        raise AssertionError("suggest must never write to the rekordbox database")

    monkeypatch.setattr(web.rekordbox, "import_files", forbidden)
    monkeypatch.setattr(web.rekordbox, "export_playlist", forbidden)
    assert client.post("/api/dj/suggest", json={"ids": ["1"]}).status_code == 200


def test_dj_suggest_db_error_is_503(client, monkeypatch):
    def boom():
        raise RuntimeError("database is locked")
    monkeypatch.setattr(web.rekordbox, "load_tracks", boom)
    assert client.post("/api/dj/suggest", json={"ids": ["1"]}).status_code == 503


# ---- dj: duplicates (read-only; works while rekordbox runs) ----

def test_dj_duplicates_groups_exact_and_fuzzy(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: True)
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", file_path="/lib/a.mp3", title="Song", duration=200),
        DJTRACK(id="2", file_path="/lib/a.mp3", title="Song", duration=200),   # exact
        DJTRACK(id="3", file_path="/lib/house/x.mp3", title="Copy", duration=180),
        DJTRACK(id="4", file_path="/lib/faves/x.mp3", title="Copy", duration=181),  # fuzzy
        DJTRACK(id="5", file_path="/lib/unique.mp3", title="Alone", duration=99),  # not a dup
    ])
    d = client.get("/api/dj/duplicates").json()
    assert d["exact_count"] == 1 and d["fuzzy_count"] == 1
    reasons = {g["reason"] for g in d["groups"]}
    assert reasons == {"exact_path", "fuzzy"}
    exact = next(g for g in d["groups"] if g["reason"] == "exact_path")
    assert {t["id"] for t in exact["tracks"]} == {"1", "2"}
    assert exact["compared"]["file_path"] == "/lib/a.mp3"
    fuzzy = next(g for g in d["groups"] if g["reason"] == "fuzzy")
    assert {t["id"] for t in fuzzy["tracks"]} == {"3", "4"}
    assert fuzzy["compared"]["title"] and fuzzy["compared"]["duration"]


def test_dj_duplicates_excludes_streaming_entries(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", file_path="spotify:track:abc", title="Song", file_state="not_a_file"),
        DJTRACK(id="2", file_path="spotify:track:abc", title="Song", file_state="not_a_file"),
    ])
    d = client.get("/api/dj/duplicates").json()
    assert d["groups"] == [] and d["exact_count"] == 0 and d["fuzzy_count"] == 0


def test_dj_duplicates_db_error_is_503(client, monkeypatch):
    def boom():
        raise RuntimeError("no db")
    monkeypatch.setattr(web.rekordbox, "load_tracks", boom)
    assert client.get("/api/dj/duplicates").status_code == 503


# ---- dj: audio (THE security surface — id resolves to a path, never path-in) ----
#
# Every test here treats the endpoint as hostile input: the {track_id} must only
# ever be used as a lookup key against the collection. A path can never reach
# open(): an unknown id is a 404, and a resolved value that is not a real
# absolute file (spotify: URI, missing file, unmounted volume) is a 404.

def _audio_track(tmp_path, name="a.mp3", data=None):
    """Write a fake audio file and return (path, bytes)."""
    if data is None:
        data = b"ID3" + bytes(range(256)) * 3   # 771 deterministic bytes
    f = tmp_path / name
    f.write_bytes(data)
    return str(f), data


def test_dj_audio_streams_full_file(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    r = client.get("/api/dj/audio/1")
    assert r.status_code == 200
    assert r.content == data
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.headers["content-length"] == str(len(data))


def test_dj_audio_range_request_is_206(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    r = client.get("/api/dj/audio/1", headers={"Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == data[10:20]
    assert r.headers["content-range"] == f"bytes 10-19/{len(data)}"
    assert r.headers["content-length"] == "10"
    assert r.headers["accept-ranges"] == "bytes"


def test_dj_audio_suffix_range(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    r = client.get("/api/dj/audio/1", headers={"Range": "bytes=-16"})
    assert r.status_code == 206
    assert r.content == data[-16:]
    n = len(data)
    assert r.headers["content-range"] == f"bytes {n - 16}-{n - 1}/{n}"


def test_dj_audio_open_ended_range(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    r = client.get("/api/dj/audio/1", headers={"Range": "bytes=500-"})
    assert r.status_code == 206
    assert r.content == data[500:]
    n = len(data)
    assert r.headers["content-range"] == f"bytes 500-{n - 1}/{n}"


def test_dj_audio_range_beyond_eof_is_416(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    r = client.get("/api/dj/audio/1", headers={"Range": "bytes=999999-1000000"})
    assert r.status_code == 416
    assert r.headers["content-range"] == f"bytes */{len(data)}"


def test_dj_audio_absurd_suffix_range_is_416(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    # a zero-length suffix is unsatisfiable, never a crash
    r = client.get("/api/dj/audio/1", headers={"Range": "bytes=-0"})
    assert r.status_code == 416


def test_dj_audio_garbage_range_falls_back_to_full(client, monkeypatch, tmp_path):
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    # a malformed Range is ignored (server MAY ignore) — full 200, never a 500
    r = client.get("/api/dj/audio/1", headers={"Range": "bytes=abc"})
    assert r.status_code == 200
    assert r.content == data


def test_dj_audio_unknown_id_is_404(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [])
    assert client.get("/api/dj/audio/1").status_code == 404


def test_dj_audio_traversal_id_never_opens_a_file(client, monkeypatch, tmp_path):
    """An id shaped like a path traversal is only ever a dict-miss → 404. It is
    never joined to a directory or opened. Belt and suspenders: even a url-encoded
    traversal and a raw one both 404."""
    path, _ = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    assert client.get("/api/dj/audio/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/dj/audio/....//etc/passwd").status_code == 404


def test_dj_audio_ignores_client_supplied_path_query(client, monkeypatch, tmp_path):
    """A path smuggled in as a query param is never honored — the file served is
    always the collection's path for the resolved id."""
    path, data = _audio_track(tmp_path)
    monkeypatch.setattr(web.rekordbox, "load_tracks",
                        lambda: [DJTRACK(id="1", file_path=path)])
    r = client.get("/api/dj/audio/1", params={"path": "/etc/passwd"})
    assert r.status_code == 200
    assert r.content == data


def test_dj_audio_spotify_uri_entry_is_404(client, monkeypatch):
    """A streaming (spotify:) entry resolves to a non-file path — never opened."""
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", file_path="spotify:track:abc", file_state="not_a_file")])
    assert client.get("/api/dj/audio/1").status_code == 404


def test_dj_audio_missing_file_is_404(client, monkeypatch, tmp_path):
    """A real absolute path whose file is gone from disk → clean 404, no traceback."""
    gone = str(tmp_path / "gone.mp3")
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", file_path=gone, file_state="missing")])
    assert client.get("/api/dj/audio/1").status_code == 404


def test_dj_audio_content_type_by_extension(client, monkeypatch, tmp_path):
    cases = {"a.mp3": "audio/mpeg", "a.aiff": "audio/aiff", "a.wav": "audio/wav",
             "a.m4a": "audio/mp4", "a.flac": "audio/flac"}
    for name, ctype in cases.items():
        path, _ = _audio_track(tmp_path, name=name)
        monkeypatch.setattr(web.rekordbox, "load_tracks",
                            lambda p=path: [DJTRACK(id="1", file_path=p)])
        r = client.get("/api/dj/audio/1")
        assert r.status_code == 200
        assert r.headers["content-type"] == ctype, name


def test_dj_audio_db_error_is_503(client, monkeypatch):
    def boom():
        raise RuntimeError("no db")
    monkeypatch.setattr(web.rekordbox, "load_tracks", boom)
    assert client.get("/api/dj/audio/1").status_code == 503


def test_run_job_auto_imports_on_success(client, monkeypatch, tmp_path):
    lines = ["Total songs: 1\n", "[ExtractAudio] Destination: x.mp3\n"]
    monkeypatch.setattr(web.subprocess, "Popen", lambda *a, **k: FakeProc(lines, 0))
    imported = []
    monkeypatch.setattr(web, "auto_import",
                        lambda output, files=None: imported.append(output))
    # Keep record_sources() off the network (see module docstring: "no network").
    # Without this, a real Spotify lookup inside record_sources races the
    # status-polling loop below whenever live credentials are configured.
    monkeypatch.setattr(web, "spotify_client", lambda: (_ for _ in ()).throw(RuntimeError("missing-credentials")))
    r = client.post("/api/download",
                    json={"urls": ["https://open.spotify.com/track/abc"],
                          "output": str(tmp_path)})
    import time
    for _ in range(200):
        if imported:                       # poll on the actual effect, not status
            break
        time.sleep(0.01)
    assert imported == [str(tmp_path)]


def test_run_job_scopes_auto_import_to_own_output(client, monkeypatch, tmp_path):
    """auto_import must be handed only the files THIS job produced, not the whole
    downloads tree — an mp3 that was already present before the job runs must
    not be re-offered to the importer."""
    (tmp_path / "already_here.mp3").write_text("x")   # present before the job

    def popen_that_downloads(*a, **k):
        (tmp_path / "fresh.mp3").write_text("x")       # the job's own new file
        return FakeProc(["Total songs: 1\n",
                         "[ExtractAudio] Destination: fresh.mp3\n"], 0)

    monkeypatch.setattr(web.subprocess, "Popen", popen_that_downloads)
    captured = []
    monkeypatch.setattr(web, "auto_import",
                        lambda output, files=None: captured.append((output, files)))
    monkeypatch.setattr(web, "spotify_client", lambda: (_ for _ in ()).throw(RuntimeError("missing-credentials")))
    r = client.post("/api/download",
                    json={"urls": ["https://open.spotify.com/track/abc"],
                          "output": str(tmp_path)})
    import time
    for _ in range(200):
        if captured:
            break
        time.sleep(0.01)
    assert captured, "auto_import was never called"
    output, files = captured[0]
    assert output == str(tmp_path)
    assert files == [str(tmp_path / "fresh.mp3")]     # only the new file


def test_auto_import_skips_when_rekordbox_open(monkeypatch, tmp_path):
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: True)
    called = []
    monkeypatch.setattr(web.rekordbox, "import_files", lambda p: called.append(p))
    REAL_AUTO_IMPORT(str(tmp_path))
    assert called == []


def test_download_never_reaches_real_auto_import(client, monkeypatch, tmp_path):
    """Even in the dangerous state (rekordbox closed), a successful download job
    must not reach rekordbox.import_files — the autouse stub protects every test."""
    lines = ["Total songs: 1\n", "[ExtractAudio] Destination: x.mp3\n"]
    monkeypatch.setattr(web.subprocess, "Popen", lambda *a, **k: FakeProc(lines, 0))
    imported = []
    monkeypatch.setattr(web.rekordbox, "import_files", lambda paths: imported.append(paths))
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: False)  # the dangerous state
    # Keep record_sources() off the network (see test_run_job_auto_imports_on_success).
    monkeypatch.setattr(web, "spotify_client", lambda: (_ for _ in ()).throw(RuntimeError("missing-credentials")))
    r = client.post("/api/download",
                    json={"urls": ["https://open.spotify.com/track/abc"],
                          "output": str(tmp_path)})
    job = web.jobs[r.json()["id"]]
    import time
    for _ in range(200):
        if job["status"] != "running":
            break
        time.sleep(0.01)
    assert job["status"] == "done"
    assert imported == []


# ---- dj: saved sets, resolution, mapping, playlists (Task 10) ----
#
# SETS_DIR is redirected to a tmp dir and load_tracks is stubbed, so nothing here
# reads or writes the real filesystem sets/ or the real rekordbox master.db.

@pytest.fixture
def sets_client(monkeypatch, tmp_path):
    monkeypatch.setattr(web, "SETS_DIR", tmp_path / "sets")
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="1", title="One", artist="A", file_path="/lib/a.mp3"),
        DJTRACK(id="2", title="Two", artist="B", file_path="/lib/b.mp3"),
        DJTRACK(id="3", title="Gone", file_path="/lib/gone.mp3", file_state="missing"),
    ])
    web._NOT_IMPORTED_CACHE.clear()
    return TestClient(web.app)


def test_dj_sets_list_and_save(sets_client):
    sets_client.post("/api/dj/sets", json={"name": "Night", "ids": ["1", "2"]})
    sets = sets_client.get("/api/dj/sets").json()["sets"]
    assert len(sets) == 1
    s = sets[0]
    assert s["name"] == "Night" and s["stem"] == "Night"
    assert s["track_count"] == 2 and s["exported"] is False


def test_dj_save_set_empty_is_400(sets_client):
    assert sets_client.post("/api/dj/sets", json={"name": "X", "ids": []}).status_code == 400
    assert sets_client.post("/api/dj/sets", json={"name": " ", "ids": ["1"]}).status_code == 400


def test_dj_open_set_resolves_id_first(sets_client):
    sets_client.post("/api/dj/sets", json={"name": "Set", "ids": ["2", "1"]})
    d = sets_client.get("/api/dj/sets/Set").json()
    assert [t["id"] for t in d["tracks"]] == ["2", "1"]   # order preserved
    assert d["path_resolved"] == [] and d["unresolved"] == []


def test_dj_open_set_missing_file_track_still_resolves(sets_client):
    sets_client.post("/api/dj/sets", json={"name": "Set", "ids": ["3"]})
    d = sets_client.get("/api/dj/sets/Set").json()
    assert [t["id"] for t in d["tracks"]] == ["3"]        # missing file resolves by id
    assert d["unresolved"] == []


def test_dj_open_set_path_fallback_when_id_changed(sets_client, monkeypatch):
    sets_client.post("/api/dj/sets", json={"name": "Set", "ids": ["1"]})
    # library rebuilt: same file path, new content id
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="NEW", file_path="/lib/a.mp3")])
    d = sets_client.get("/api/dj/sets/Set").json()
    assert [t["id"] for t in d["tracks"]] == ["NEW"]
    assert d["path_resolved"] == [{"id": "1", "path": "/lib/a.mp3", "resolved_id": "NEW"}]
    assert d["unresolved"] == []


def test_dj_open_set_unresolvable_reported(sets_client, monkeypatch):
    sets_client.post("/api/dj/sets", json={"name": "Set", "ids": ["1"]})
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        DJTRACK(id="OTHER", file_path="/lib/other.mp3")])   # neither id nor path match
    d = sets_client.get("/api/dj/sets/Set").json()
    assert d["tracks"] == []
    assert d["unresolved"] == [{"id": "1", "path": "/lib/a.mp3"}]


def test_dj_open_set_404_for_missing(sets_client):
    assert sets_client.get("/api/dj/sets/ghost").status_code == 404


def test_dj_rename_set(sets_client):
    sets_client.post("/api/dj/sets", json={"name": "Old", "ids": ["1"]})
    r = sets_client.patch("/api/dj/sets/Old", json={"name": "New"})
    assert r.status_code == 200 and r.json()["stem"] == "New"
    names = {s["name"] for s in sets_client.get("/api/dj/sets").json()["sets"]}
    assert names == {"New"}


def test_dj_rename_missing_is_404(sets_client):
    assert sets_client.patch("/api/dj/sets/ghost", json={"name": "X"}).status_code == 404


def test_dj_duplicate_set(sets_client):
    sets_client.post("/api/dj/sets", json={"name": "Src", "ids": ["1", "2"]})
    r = sets_client.post("/api/dj/sets/Src/duplicate")
    assert r.status_code == 200 and r.json()["stem"] != "Src"
    assert len(sets_client.get("/api/dj/sets").json()["sets"]) == 2


def test_dj_delete_set_removes_only_files_never_a_playlist(sets_client, monkeypatch):
    sets_client.post("/api/dj/sets", json={"name": "Doomed", "ids": ["1"]})
    # deleting a set must never reach any rekordbox write path
    monkeypatch.setattr(web.rekordbox, "export_playlist",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("touched a playlist")))
    monkeypatch.setattr(web.rekordbox, "backup_master_db",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("backed up db")))
    assert sets_client.delete("/api/dj/sets/Doomed").json() == {"ok": True}
    assert sets_client.get("/api/dj/sets").json()["sets"] == []
    assert sets_client.delete("/api/dj/sets/Doomed").status_code == 404


def test_dj_set_name_traversal_is_contained(sets_client, tmp_path):
    """Every name-taking set endpoint neutralizes traversal — no file outside the
    sets dir is created, read, renamed, or deleted."""
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    # save with a traversal name lands inside sets/, never at the target
    sets_client.post("/api/dj/sets", json={"name": "../../secret", "ids": ["1"]})
    assert secret.read_text() == "top secret"
    # delete/rename/duplicate with traversal stems never escape either
    assert sets_client.delete("/api/dj/sets/..%2F..%2Fsecret").status_code in (404, 200)
    assert secret.exists()
    assert sets_client.patch("/api/dj/sets/..%2F..%2Fsecret.txt", json={"name": "x"}).status_code == 404
    assert secret.read_text() == "top secret"


def test_dj_export_records_mapping_for_a_saved_set(sets_client, monkeypatch):
    save = sets_client.post("/api/dj/sets", json={"name": "Mapped", "ids": ["1"]}).json()
    monkeypatch.setattr(web.rekordbox, "export_playlist",
                        lambda name, ids: {"playlist": name, "playlist_id": "PL100"})
    sets_client.post("/api/dj/export",
                     json={"name": "Mapped", "ids": ["1"], "set": save["stem"]})
    s = next(s for s in sets_client.get("/api/dj/sets").json()["sets"] if s["stem"] == save["stem"])
    assert s["exported"] is True
    assert s["rekordbox_playlist_id"] == "PL100"


def test_dj_reexport_updates_mapping_to_new_playlist(sets_client, monkeypatch):
    save = sets_client.post("/api/dj/sets", json={"name": "Re", "ids": ["1"]}).json()
    seq = iter([{"playlist": "Re", "playlist_id": "PL1"},
                {"playlist": "Re (2)", "playlist_id": "PL2"}])
    monkeypatch.setattr(web.rekordbox, "export_playlist", lambda name, ids: next(seq))
    sets_client.post("/api/dj/export", json={"name": "Re", "ids": ["1"], "set": save["stem"]})
    sets_client.post("/api/dj/export", json={"name": "Re", "ids": ["1"], "set": save["stem"]})
    s = next(s for s in sets_client.get("/api/dj/sets").json()["sets"] if s["stem"] == save["stem"])
    assert s["rekordbox_playlist_id"] == "PL2"          # new playlist, mapping updated
    assert s["rekordbox_playlist_name"] == "Re (2)"


def test_dj_playlists_read_only(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running", lambda: True)
    monkeypatch.setattr(web.rekordbox, "read_playlists", lambda: [
        {"id": "p1", "name": "Warmup", "track_count": 2, "track_ids": ["1", "2"]}])
    d = client.get("/api/dj/playlists").json()
    assert d["playlists"][0]["name"] == "Warmup"
    assert d["playlists"][0]["track_ids"] == ["1", "2"]


def test_dj_playlists_db_error_is_503(client, monkeypatch):
    monkeypatch.setattr(web.rekordbox, "read_playlists",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    assert client.get("/api/dj/playlists").status_code == 503


# ---- static serving (dist required) ----

def test_index_serves_dist_when_present(client, monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>CRATE</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setattr(web, "DIST_DIR", dist)
    r = client.get("/")
    assert r.status_code == 200 and "CRATE" in r.text
    r = client.get("/assets/app.js")
    assert r.status_code == 200 and "console.log" in r.text


def test_index_500_when_not_built(client, monkeypatch, tmp_path):
    monkeypatch.setattr(web, "DIST_DIR", tmp_path / "nope")
    r = client.get("/")
    assert r.status_code == 500 and "bun run build" in r.json()["detail"]


def test_favicon_served_from_dist(client, monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "favicon.svg").write_text("<svg/>")
    monkeypatch.setattr(web, "DIST_DIR", dist)
    assert client.get("/favicon.svg").status_code == 200


def test_assets_blocks_traversal(client, monkeypatch, tmp_path):
    # httpx/TestClient normalizes ".." out of URLs before they reach the app,
    # so call the handler directly — that's what a raw socket could deliver.
    from fastapi import HTTPException

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("x")
    sibling = tmp_path / "distractor"
    sibling.mkdir()
    (sibling / "secret.txt").write_text("TOP SECRET")
    monkeypatch.setattr(web, "DIST_DIR", dist)
    # sibling dir sharing the "dist" prefix — the startswith pitfall
    with pytest.raises(HTTPException) as exc:
        web.dist_assets("../../distractor/secret.txt")
    assert exc.value.status_code == 404
    # escaping assets/ but staying inside dist/
    with pytest.raises(HTTPException) as exc:
        web.dist_assets("../index.html")
    assert exc.value.status_code == 404
