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
    monkeypatch.setattr(web, "auto_import", lambda output: None)


@pytest.fixture
def client():
    web.jobs.clear()
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
    # Keep record_sources() off the network (see module docstring: "no network").
    # Without this, a real Spotify lookup inside record_sources races the
    # status-polling loop below whenever live credentials are configured.
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
    assert imported == [str(tmp_path)]


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
