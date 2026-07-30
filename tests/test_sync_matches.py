import json

from spotify_dl import sync
from spotify_dl.resolver import evaluate_candidates
from spotify_dl.sync import (
    apply_manual_decision,
    audit_match_decisions,
    classify_sync_actions,
    get_verified_cache_entry,
    load_manifest,
)


def decision(status="verified"):
    result = evaluate_candidates(
        {
            "spotify_id": "spotify-id",
            "name": "Track",
            "artist": "Artist",
            "album": "Album",
            "duration_ms": 180_000,
        },
        [
            {
                "videoId": "video-id",
                "title": "Track",
                "artists": [{"name": "Artist"}],
                "duration_seconds": 180,
            }
        ],
    )
    result["status"] = status
    return result


def test_load_manifest_migrates_match_contract(tmp_path):
    (tmp_path / ".spotify_dl_manifest.json").write_text(
        json.dumps({"version": 1, "cache": {}, "playlists": {}}),
        encoding="utf-8",
    )

    manifest = load_manifest(tmp_path)

    assert manifest["version"] == 2
    assert manifest["matches"] == {}
    assert manifest["playlist_url_cache"] == {}


def test_verified_or_manual_cache_entry_is_available():
    for status in ("verified", "manual"):
        entry = {
            "filename": "Artist - Track.mp3",
            "match": decision(status),
        }
        manifest = {"cache": {"spotify-id": entry}, "matches": {}}

        assert get_verified_cache_entry(manifest, "spotify-id") == entry


def test_unsafe_or_legacy_cache_entry_falls_back_as_unavailable():
    for entry in (
        {"filename": "legacy.mp3"},
        {"filename": "rejected.mp3", "match": decision("rejected")},
        {"filename": "ambiguous.mp3", "match": decision("ambiguous")},
    ):
        manifest = {"cache": {"spotify-id": entry}, "matches": {}}

        assert get_verified_cache_entry(manifest, "spotify-id") is None


def test_rejected_track_is_reconsidered_on_a_later_sync(tmp_path):
    cache_dir = tmp_path / ".cache"
    playlist_dir = tmp_path / "Playlist"
    cache_dir.mkdir()
    playlist_dir.mkdir()
    (cache_dir / "unsafe.mp3").write_text("opaque", encoding="utf-8")
    manifest = {
        "cache": {
            "spotify-id": {
                "filename": "unsafe.mp3",
                "match": decision("rejected"),
            }
        },
        "matches": {},
    }

    actions = classify_sync_actions(
        {"spotify-id"},
        {"spotify-id"},
        manifest,
        cache_dir,
        playlist_dir,
    )

    assert actions["needs_download"] == ["spotify-id"]
    assert actions["needs_copy"] == []


def test_verified_track_is_copied_only_when_playlist_file_is_missing(tmp_path):
    cache_dir = tmp_path / ".cache"
    playlist_dir = tmp_path / "Playlist"
    cache_dir.mkdir()
    playlist_dir.mkdir()
    (cache_dir / "verified.mp3").write_text("audio", encoding="utf-8")
    manifest = {
        "cache": {
            "spotify-id": {
                "filename": "verified.mp3",
                "match": decision("verified"),
            }
        },
        "matches": {},
    }

    missing = classify_sync_actions(
        {"spotify-id"}, {"spotify-id"}, manifest, cache_dir, playlist_dir
    )
    assert missing["needs_copy"] == ["spotify-id"]

    (playlist_dir / "verified.mp3").write_text("audio", encoding="utf-8")
    present = classify_sync_actions(
        {"spotify-id"}, {"spotify-id"}, manifest, cache_dir, playlist_dir
    )
    assert present["needs_copy"] == []
    assert present["needs_download"] == []


def test_manual_rejection_invalidates_previously_verified_cache():
    entry = {"filename": "track.mp3", "match": decision("verified")}
    manifest = {
        "cache": {"spotify-id": entry},
        "matches": {"spotify-id": entry["match"]},
    }

    apply_manual_decision(manifest, "spotify-id", decision("rejected"))

    assert entry["match_status"] == "rejected"
    assert get_verified_cache_entry(manifest, "spotify-id") is None


def test_changed_manual_source_cannot_relabel_existing_audio():
    entry = {"filename": "track.mp3", "match": decision("verified")}
    manifest = {
        "cache": {"spotify-id": entry},
        "matches": {"spotify-id": entry["match"]},
    }
    manual = decision("manual")
    manual["source"]["video_id"] = "different-video"

    apply_manual_decision(manifest, "spotify-id", manual)

    assert entry["match_status"] == "stale"
    assert get_verified_cache_entry(manifest, "spotify-id") is None


def test_same_source_manual_approval_keeps_existing_audio_available():
    entry = {"filename": "track.mp3", "match": decision("verified")}
    manifest = {
        "cache": {"spotify-id": entry},
        "matches": {"spotify-id": entry["match"]},
    }
    manual = decision("manual")

    apply_manual_decision(manifest, "spotify-id", manual)

    assert entry["match_status"] == "manual"
    assert get_verified_cache_entry(manifest, "spotify-id") is entry


def test_failed_source_change_restores_old_file_without_approving_it(
    monkeypatch, tmp_path
):
    cache_dir = tmp_path / ".cache"
    cache_dir.mkdir()
    existing = cache_dir / "Artist - Track.mp3"
    existing.write_text("old audio", encoding="utf-8")
    manual = decision("manual")
    manual["source"]["video_id"] = "different-video"

    monkeypatch.setattr(
        sync,
        "download_songs",
        lambda **kwargs: {"spotify-id": manual},
    )

    result = sync.download_to_cache_batch(
        [
            (
                "spotify-id",
                {
                    "spotify_id": "spotify-id",
                    "name": "Track",
                    "artist": "Artist",
                },
            )
        ],
        cache_dir,
        {"_match_store_path": str(tmp_path / "matches.json")},
    )

    assert result["spotify-id"]["filename"] is None
    assert existing.read_text(encoding="utf-8") == "old audio"
    assert not list(cache_dir.glob("*.spotify-dl-backup"))


def test_successful_source_change_replaces_old_file(monkeypatch, tmp_path):
    cache_dir = tmp_path / ".cache"
    cache_dir.mkdir()
    existing = cache_dir / "Artist - Track.mp3"
    existing.write_text("old audio", encoding="utf-8")
    manual = decision("manual")
    manual["source"]["video_id"] = "different-video"

    def download_new_source(**kwargs):
        assert kwargs["cookies_from_browser"] == "chrome"
        assert kwargs["cookies_browser_profile"] == "Profile 1"
        assert kwargs["youtube_hls_fallback"] is True
        assert kwargs["youtube_hls_preferred"] is True
        assert kwargs["download_retries"] == 7
        assert kwargs["fragment_retries"] == 8
        assert kwargs["extractor_retries"] == 4
        assert kwargs["retry_backoff_seconds"] == 3
        assert kwargs["retry_backoff_max_seconds"] == 45
        assert kwargs["sleep_interval_requests"] == 1.5
        assert kwargs["sleep_interval"] == 2
        assert kwargs["max_sleep_interval"] == 5
        existing.write_text("new audio", encoding="utf-8")
        return {"spotify-id": manual}

    monkeypatch.setattr(sync, "download_songs", download_new_source)

    result = sync.download_to_cache_batch(
        [
            (
                "spotify-id",
                {
                    "spotify_id": "spotify-id",
                    "name": "Track",
                    "artist": "Artist",
                },
            )
        ],
        cache_dir,
        {
            "_match_store_path": str(tmp_path / "matches.json"),
            "cookies_from_browser": "chrome",
            "cookies_browser_profile": "Profile 1",
            "youtube_hls_fallback": True,
            "youtube_hls_preferred": True,
            "download_retries": 7,
            "fragment_retries": 8,
            "extractor_retries": 4,
            "retry_backoff_seconds": 3,
            "retry_backoff_max_seconds": 45,
            "sleep_interval_requests": 1.5,
            "sleep_interval": 2,
            "max_sleep_interval": 5,
        },
    )

    assert result["spotify-id"]["filename"] == "Artist - Track.mp3"
    assert existing.read_text(encoding="utf-8") == "new audio"
    assert not list(cache_dir.glob("*.spotify-dl-backup"))


def test_audit_emits_decision_without_blessing_opaque_cache():
    verified = decision("verified")
    manifest = {
        "cache": {"spotify-id": {"filename": "opaque.mp3"}},
        "matches": {},
    }

    class Resolver:
        def resolve(self, track):
            return verified

    counts = audit_match_decisions(
        {"spotify-id": {"spotify_id": "spotify-id"}},
        manifest,
        Resolver(),
    )

    assert counts["verified"] == 1
    assert manifest["matches"]["spotify-id"] == verified
    assert manifest["cache"]["spotify-id"]["match_status"] == "stale"
    assert get_verified_cache_entry(manifest, "spotify-id") is None


def test_audit_keeps_cache_available_when_provenance_matches():
    old = decision("verified")
    current = decision("verified")
    entry = {"filename": "verified.mp3", "match": old}
    manifest = {
        "cache": {"spotify-id": entry},
        "matches": {"spotify-id": old},
    }

    class Resolver:
        def resolve(self, track):
            return current

    audit_match_decisions(
        {"spotify-id": {"spotify_id": "spotify-id"}},
        manifest,
        Resolver(),
    )

    assert entry["match"] == current
    assert entry["match_status"] == "verified"
    assert get_verified_cache_entry(manifest, "spotify-id") is entry
