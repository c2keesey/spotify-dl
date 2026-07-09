"""Tests for spotify_dl/setfile.py (m3u8 + JSON sidecar) and the two read-only
export endpoints in web.py.

Nothing here touches the real rekordbox master.db: the endpoints only ever call
rekordbox.load_tracks() (read), and the tests stub it. A guard test asserts the
export endpoints never reach a write path even while rekordbox is "running".
"""

import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlparse

import pytest
from fastapi.testclient import TestClient

from spotify_dl import setfile, web


def TRACK(**kw):
    base = {"id": "1", "title": "Song", "artist": "Artist", "bpm": 124.0,
            "key_name": "Am", "camelot": "8A", "file_path": "/lib/a.mp3",
            "duration": 200, "status": "analyzed", "file_state": "present"}
    base.update(kw)
    return base


# ---- save / m3u8 ----

def test_m3u8_round_trip(tmp_path):
    tracks = [TRACK(id="1", artist="A1", title="T1", file_path="/lib/a.mp3", duration=180),
              TRACK(id="2", artist="A2", title="T2", file_path="/lib/b.mp3", duration=200)]
    m3u8 = setfile.save(tmp_path, "My Set", tracks)
    lines = m3u8.read_text().splitlines()
    assert lines[0] == "#EXTM3U"
    assert lines[1] == "#EXTINF:180,A1 - T1"
    assert lines[2] == "/lib/a.mp3"
    assert lines[3] == "#EXTINF:200,A2 - T2"
    assert lines[4] == "/lib/b.mp3"
    # paths appear in set order
    assert lines.index("/lib/a.mp3") < lines.index("/lib/b.mp3")


def test_sidecar_round_trip(tmp_path):
    tracks = [TRACK(id="7", file_path="/lib/a.mp3"),
              TRACK(id="9", file_path="/lib/b.mp3")]
    m3u8 = setfile.save(tmp_path, "My Set", tracks)
    data = setfile.load(m3u8)
    assert data["name"] == "My Set"
    assert data["rekordbox_playlist_id"] is None
    assert data["created_at"]
    assert data["tracks"] == [{"id": "7", "path": "/lib/a.mp3"},
                              {"id": "9", "path": "/lib/b.mp3"}]


def test_load_falls_back_to_m3u8_when_sidecar_absent(tmp_path):
    # a hand-made m3u8 with no sidecar still opens
    m3u8 = tmp_path / "handmade.m3u8"
    m3u8.write_text("#EXTM3U\n#EXTINF:240,DJ Foo - Bar\n/music/bar.mp3\n")
    data = setfile.load(m3u8)
    assert data["name"] == "handmade"
    assert len(data["tracks"]) == 1
    t = data["tracks"][0]
    assert t["id"] is None            # parsed from bare m3u8: path but no id
    assert t["path"] == "/music/bar.mp3"
    assert t["artist"] == "DJ Foo"
    assert t["title"] == "Bar"


def test_load_prefers_sidecar_over_m3u8(tmp_path):
    m3u8 = setfile.save(tmp_path, "Set", [TRACK(id="5", file_path="/lib/a.mp3")])
    data = setfile.load(m3u8)
    assert data["tracks"][0]["id"] == "5"   # sidecar wins (has ids)


# ---- filename safety ----

def test_traversal_name_cannot_escape_dir(tmp_path):
    m3u8 = setfile.save(tmp_path, "../../etc/passwd", [TRACK(file_path="/lib/a.mp3")])
    # the file must live directly inside tmp_path, not up the tree
    assert m3u8.resolve().parent == tmp_path.resolve()
    assert m3u8.suffix == ".m3u8"
    # no stray file escaped
    assert not (tmp_path.parent.parent / "etc" / "passwd").exists()


def test_absurd_names_still_produce_a_file(tmp_path):
    for name in ["..", ".", "   ", "/", "\\", "con/../../x"]:
        m3u8 = setfile.save(tmp_path, name, [TRACK(file_path="/lib/a.mp3")])
        assert m3u8.resolve().parent == tmp_path.resolve()
        assert m3u8.exists()


# ---- missing-file / streaming handling ----

def test_missing_file_track_still_written_to_m3u8(tmp_path):
    # a moved/missing file keeps its absolute path (playlist self-heals later)
    tracks = [TRACK(id="1", file_path="/lib/gone.mp3", file_state="missing")]
    m3u8 = setfile.save(tmp_path, "Set", tracks)
    assert "/lib/gone.mp3" in m3u8.read_text()


def test_spotify_uri_track_excluded_from_m3u8(tmp_path):
    tracks = [TRACK(id="1", file_path="/lib/a.mp3"),
              TRACK(id="2", file_path="spotify:track:abc123", file_state="not_a_file")]
    m3u8 = setfile.save(tmp_path, "Set", tracks)
    text = m3u8.read_text()
    assert "/lib/a.mp3" in text
    assert "spotify:track:abc123" not in text
    # but the sidecar keeps full Crate state
    data = setfile.load(m3u8)
    assert [t["id"] for t in data["tracks"]] == ["1", "2"]


# ---- rekordbox XML ----

def test_xml_is_well_formed_and_structured(tmp_path):
    tracks = [TRACK(id="1", title="One", artist="A", bpm=124.0, key_name="Am",
                    duration=180, file_path="/lib/a.mp3"),
              TRACK(id="2", title="Two", artist="B", bpm=126.0, key_name="C",
                    duration=200, file_path="/lib/b.mp3")]
    xml = setfile.to_rekordbox_xml(tracks, "My Set")
    root = ET.fromstring(xml)                       # parses back => well-formed
    assert root.tag == "DJ_PLAYLISTS"
    collection = root.find("COLLECTION")
    assert collection.get("Entries") == "2"
    trk = collection.findall("TRACK")
    assert trk[0].get("TrackID") == "1"
    assert trk[0].get("Name") == "One"
    assert trk[0].get("Artist") == "A"
    assert trk[0].get("AverageBpm") == "124.00"
    assert trk[0].get("Tonality") == "Am"
    assert trk[0].get("TotalTime") == "180"
    # playlist references the tracks in order
    node = root.find("PLAYLISTS").find("NODE").find("NODE")
    assert node.get("Name") == "My Set"
    keys = [t.get("Key") for t in node.findall("TRACK")]
    assert keys == ["1", "2"]


def test_xml_escapes_special_characters(tmp_path):
    tracks = [TRACK(id="1", title="Rock & Roll <Live>", artist='A "B"',
                    file_path="/lib/a.mp3")]
    xml = setfile.to_rekordbox_xml(tracks, "Set & Stuff")
    root = ET.fromstring(xml)                       # would raise if unescaped
    trk = root.find("COLLECTION").find("TRACK")
    assert trk.get("Name") == "Rock & Roll <Live>"
    assert trk.get("Artist") == 'A "B"'


def test_location_url_encodes_spaces_and_non_ascii(tmp_path):
    path = "/Users/dj/Music/track 「」.mp3"
    xml = setfile.to_rekordbox_xml([TRACK(id="1", file_path=path)], "Set")
    root = ET.fromstring(xml)
    loc = root.find("COLLECTION").find("TRACK").get("Location")
    assert loc.startswith("file://localhost/")
    assert "%20" in loc                              # space percent-encoded
    assert "「" not in loc and "%E3%80%8C" in loc     # non-ascii percent-encoded
    # decodes back to the original filesystem path
    assert unquote(urlparse(loc).path) == path


def test_xml_omits_spotify_uri_tracks(tmp_path):
    tracks = [TRACK(id="1", file_path="/lib/a.mp3"),
              TRACK(id="2", file_path="spotify:track:abc", file_state="not_a_file")]
    xml = setfile.to_rekordbox_xml(tracks, "Set")
    root = ET.fromstring(xml)
    assert root.find("COLLECTION").get("Entries") == "1"
    assert "spotify:track:abc" not in xml
    # A spotify: URI must never be dressed up as a file:// location.
    locations = [t.get("Location") for t in root.find("COLLECTION")]
    assert locations == ["file://localhost/lib/a.mp3"]
    locs = [t.get("Location") for t in root.find("COLLECTION").findall("TRACK")]
    assert all(l.startswith("file://localhost/") for l in locs)


def test_xml_missing_file_still_included(tmp_path):
    # a missing file keeps a valid Location (id-first / path resolution can heal)
    xml = setfile.to_rekordbox_xml(
        [TRACK(id="1", file_path="/lib/gone.mp3", file_state="missing")], "Set")
    root = ET.fromstring(xml)
    assert root.find("COLLECTION").get("Entries") == "1"


# ---- list_sets ----

def test_list_sets(tmp_path):
    setfile.save(tmp_path, "Alpha", [TRACK(id="1", file_path="/lib/a.mp3")])
    setfile.save(tmp_path, "Beta", [TRACK(id="2", file_path="/lib/b.mp3"),
                                    TRACK(id="3", file_path="/lib/c.mp3")])
    sets = setfile.list_sets(tmp_path)
    names = {s["name"]: s for s in sets}
    assert set(names) == {"Alpha", "Beta"}
    assert names["Beta"]["track_count"] == 2
    assert names["Alpha"]["rekordbox_playlist_id"] is None


def test_list_sets_empty_dir(tmp_path):
    assert setfile.list_sets(tmp_path / "nope") == []


# ---- endpoints ----

@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(web, "SETS_DIR", tmp_path / "sets")
    monkeypatch.setattr(web.rekordbox, "load_tracks", lambda: [
        TRACK(id="1", title="One", artist="A", file_path="/lib/a.mp3"),
        TRACK(id="2", title="Two", artist="B", file_path="/lib/b.mp3"),
        TRACK(id="3", file_path="spotify:track:xyz", file_state="not_a_file")])
    return TestClient(web.app)


def test_export_m3u8_endpoint_writes_and_returns_path(client, tmp_path):
    r = client.post("/api/dj/export/m3u8", json={"name": "Night", "ids": ["2", "1"]})
    assert r.status_code == 200
    path = r.json()["path"]
    assert path.endswith(".m3u8")
    text = open(path).read()
    # order honored: id 2 first, then id 1
    assert text.index("/lib/b.mp3") < text.index("/lib/a.mp3")


def test_export_xml_endpoint_returns_xml_body(client):
    r = client.post("/api/dj/export/xml", json={"name": "Night", "ids": ["1", "2"]})
    assert r.status_code == 200
    assert "application/xml" in r.headers["content-type"]
    root = ET.fromstring(r.text)
    keys = [t.get("Key") for t in root.find("PLAYLISTS").find("NODE").find("NODE").findall("TRACK")]
    assert keys == ["1", "2"]


def test_export_m3u8_unknown_id_is_400(client):
    r = client.post("/api/dj/export/m3u8", json={"name": "Set", "ids": ["1", "999"]})
    assert r.status_code == 400
    assert "999" in r.json()["detail"]


def test_export_xml_unknown_id_is_400(client):
    r = client.post("/api/dj/export/xml", json={"name": "Set", "ids": ["999"]})
    assert r.status_code == 400


def test_export_empty_is_400(client):
    assert client.post("/api/dj/export/m3u8", json={"name": "S", "ids": []}).status_code == 400
    assert client.post("/api/dj/export/xml", json={"name": " ", "ids": ["1"]}).status_code == 400


def test_exports_never_touch_the_rekordbox_write_path(client, monkeypatch):
    """The whole point: exports are read-only, so they must work while rekordbox
    is OPEN and must never call backup/open-for-write/running-gate."""
    def boom(*a, **k):
        raise AssertionError("export reached the rekordbox write path")
    monkeypatch.setattr(web.rekordbox, "backup_master_db", boom)
    monkeypatch.setattr(web.rekordbox, "open_db", boom)
    # rekordbox is running: a write path would 409, an export must still succeed
    monkeypatch.setattr(web.rekordbox, "is_rekordbox_running",
                        lambda: (_ for _ in ()).throw(
                            AssertionError("export used the running gate")))
    assert client.post("/api/dj/export/m3u8",
                       json={"name": "Live", "ids": ["1"]}).status_code == 200
    assert client.post("/api/dj/export/xml",
                       json={"name": "Live", "ids": ["1"]}).status_code == 200


def test_save_uniquifies_when_distinct_names_collide(tmp_path):
    """"My Set!" and "My Set?" both sanitize to "My Set_" — the second must not
    silently destroy the first."""
    a = setfile.save(tmp_path, "My Set!", [TRACK(id="1", file_path="/lib/a.mp3")])
    b = setfile.save(tmp_path, "My Set?", [TRACK(id="2", file_path="/lib/b.mp3")])
    assert a != b
    assert setfile.load(a)["name"] == "My Set!"
    assert setfile.load(b)["name"] == "My Set?"
    assert [t["id"] for t in setfile.load(a)["tracks"]] == ["1"]
    assert [t["id"] for t in setfile.load(b)["tracks"]] == ["2"]


def test_save_same_name_overwrites_in_place(tmp_path):
    """Re-saving the SAME set is an edit, not a new set — no "(2)" pileup."""
    a = setfile.save(tmp_path, "Warehouse", [TRACK(id="1", file_path="/lib/a.mp3")])
    b = setfile.save(tmp_path, "Warehouse", [TRACK(id="2", file_path="/lib/b.mp3")])
    assert a == b
    assert [t["id"] for t in setfile.load(a)["tracks"]] == ["2"]
    assert sorted(p.name for p in tmp_path.glob("*.m3u8")) == ["Warehouse.m3u8"]


def test_save_does_not_clobber_a_foreign_m3u8(tmp_path):
    """A hand-made m3u8 with no sidecar belongs to someone else."""
    (tmp_path / "Warehouse.m3u8").write_text("#EXTM3U\n/lib/theirs.mp3\n", encoding="utf-8")
    p = setfile.save(tmp_path, "Warehouse", [TRACK(id="1", file_path="/lib/a.mp3")])
    assert p.name == "Warehouse (2).m3u8"
    assert "/lib/theirs.mp3" in (tmp_path / "Warehouse.m3u8").read_text()


def test_m3u8_label_cannot_inject_directives(tmp_path):
    """An interior newline in a tag must not become an extra m3u8 line."""
    evil = TRACK(id="1", file_path="/lib/a.mp3",
                 title="Boom\n/etc/evil.mp3\n#EXTINF:0,injected", artist="A\nB")
    p = setfile.save(tmp_path, "Set", [evil])
    lines = p.read_text(encoding="utf-8").strip().split("\n")
    assert lines == ["#EXTM3U", "#EXTINF:200,A B - Boom /etc/evil.mp3 #EXTINF:0,injected", "/lib/a.mp3"]
    assert [t["path"] for t in setfile.load(p)["tracks"]] == ["/lib/a.mp3"]


# ---- list_sets: stem + exported flag (Task 10) ----

def test_list_sets_reports_stem_and_exported(tmp_path):
    setfile.save(tmp_path, "Alpha", [TRACK(id="1", file_path="/lib/a.mp3")])
    b = setfile.save(tmp_path, "Beta", [TRACK(id="2", file_path="/lib/b.mp3")])
    setfile.set_mapping(tmp_path, b.stem, "PL42", "Beta (rekordbox)")
    by_name = {s["name"]: s for s in setfile.list_sets(tmp_path)}
    assert by_name["Alpha"]["stem"] == "Alpha"
    assert by_name["Alpha"]["exported"] is False
    assert by_name["Beta"]["exported"] is True
    assert by_name["Beta"]["rekordbox_playlist_id"] == "PL42"
    assert by_name["Beta"]["rekordbox_playlist_name"] == "Beta (rekordbox)"


# ---- rename ----

def test_rename_moves_files_and_updates_name(tmp_path):
    m = setfile.save(tmp_path, "Old", [TRACK(id="1", file_path="/lib/a.mp3")])
    assert m.stem == "Old"
    new = setfile.rename(tmp_path, "Old", "New Name")
    assert new.stem == "New Name"
    assert not (tmp_path / "Old.m3u8").exists()
    assert not (tmp_path / "Old.json").exists()
    assert setfile.load(new)["name"] == "New Name"
    assert [t["id"] for t in setfile.load(new)["tracks"]] == ["1"]


def test_rename_preserves_playlist_mapping(tmp_path):
    m = setfile.save(tmp_path, "Old", [TRACK(id="1", file_path="/lib/a.mp3")])
    setfile.set_mapping(tmp_path, m.stem, "PL9", "Old (rb)")
    new = setfile.rename(tmp_path, "Old", "Fresh")
    assert setfile.load(new)["rekordbox_playlist_id"] == "PL9"


def test_rename_missing_set_returns_none(tmp_path):
    assert setfile.rename(tmp_path, "ghost", "x") is None


def test_rename_does_not_clobber_a_different_set(tmp_path):
    setfile.save(tmp_path, "Keep", [TRACK(id="1", file_path="/lib/a.mp3")])
    setfile.save(tmp_path, "Move", [TRACK(id="2", file_path="/lib/b.mp3")])
    new = setfile.rename(tmp_path, "Move", "Keep")  # collides with an existing set
    assert new.stem != "Keep"                       # uniquified, not overwritten
    assert [t["id"] for t in setfile.load(tmp_path / "Keep.m3u8")["tracks"]] == ["1"]


# ---- duplicate ----

def test_duplicate_creates_independent_copy(tmp_path):
    setfile.save(tmp_path, "Source", [TRACK(id="1", file_path="/lib/a.mp3"),
                                      TRACK(id="2", file_path="/lib/b.mp3")])
    dup = setfile.duplicate(tmp_path, "Source")
    assert dup.stem != "Source"
    assert (tmp_path / "Source.m3u8").exists()       # original untouched
    assert [t["id"] for t in setfile.load(dup)["tracks"]] == ["1", "2"]


def test_duplicate_resets_playlist_mapping(tmp_path):
    m = setfile.save(tmp_path, "Src", [TRACK(id="1", file_path="/lib/a.mp3")])
    setfile.set_mapping(tmp_path, m.stem, "PL1", "Src (rb)")
    dup = setfile.duplicate(tmp_path, "Src")
    assert setfile.load(dup)["rekordbox_playlist_id"] is None


def test_duplicate_missing_returns_none(tmp_path):
    assert setfile.duplicate(tmp_path, "ghost") is None


# ---- delete ----

def test_delete_removes_only_set_files(tmp_path):
    setfile.save(tmp_path, "Gone", [TRACK(id="1", file_path="/lib/a.mp3")])
    keep = tmp_path / "OtherSet.m3u8"
    keep.write_text("#EXTM3U\n", encoding="utf-8")
    assert setfile.delete(tmp_path, "Gone") is True
    assert not (tmp_path / "Gone.m3u8").exists()
    assert not (tmp_path / "Gone.json").exists()
    assert keep.exists()                             # a different set survives


def test_delete_missing_returns_false(tmp_path):
    assert setfile.delete(tmp_path, "ghost") is False


def test_delete_traversal_name_is_contained(tmp_path):
    victim = tmp_path.parent / "victim.m3u8"
    victim.write_text("secret", encoding="utf-8")
    try:
        assert setfile.delete(tmp_path, "../victim") is False
        assert victim.exists()                       # never escaped the sets dir
    finally:
        victim.unlink(missing_ok=True)


# ---- resolution: id-first, path fallback, report the rest ----

def _by(records):
    by_id = {r["id"]: r for r in records}
    by_path = {r["file_path"]: r for r in records if r["file_path"]}
    return by_id, by_path


def test_resolve_id_first(tmp_path):
    live = [TRACK(id="1", file_path="/lib/moved.mp3")]
    by_id, by_path = _by(live)
    tracks, path_res, unresolved = setfile.resolve_entries(
        [{"id": "1", "path": "/lib/OLD.mp3"}], by_id, by_path)
    assert [t["id"] for t in tracks] == ["1"]        # id wins over the stale path
    assert path_res == [] and unresolved == []


def test_resolve_path_fallback_when_id_changed(tmp_path):
    # the content id changed (library rebuild) but the file path is unchanged
    live = [TRACK(id="NEW", file_path="/lib/a.mp3")]
    by_id, by_path = _by(live)
    tracks, path_res, unresolved = setfile.resolve_entries(
        [{"id": "OLD", "path": "/lib/a.mp3"}], by_id, by_path)
    assert [t["id"] for t in tracks] == ["NEW"]
    assert path_res == [{"id": "OLD", "path": "/lib/a.mp3", "resolved_id": "NEW"}]
    assert unresolved == []


def test_resolve_unresolvable_is_reported(tmp_path):
    by_id, by_path = _by([TRACK(id="1", file_path="/lib/a.mp3")])
    tracks, path_res, unresolved = setfile.resolve_entries(
        [{"id": "9", "path": "/lib/vanished.mp3"}], by_id, by_path)
    assert tracks == [] and path_res == []
    assert unresolved == [{"id": "9", "path": "/lib/vanished.mp3"}]


def test_resolve_missing_file_track_still_resolves(tmp_path):
    # a track whose file is gone from disk still has a DB record => resolves by id
    live = [TRACK(id="1", file_path="/lib/gone.mp3", file_state="missing")]
    by_id, by_path = _by(live)
    tracks, path_res, unresolved = setfile.resolve_entries(
        [{"id": "1", "path": "/lib/gone.mp3"}], by_id, by_path)
    assert [t["id"] for t in tracks] == ["1"]
    assert unresolved == []
