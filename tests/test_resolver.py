import json

import pytest

from spotify_dl import youtube
from spotify_dl.resolver import (
    AUDIO_ANALYSIS_POLICY,
    MatchStore,
    TrackResolver,
    evaluate_candidates,
)


def track(name, artist, duration_ms=180_000, spotify_id="spotify-id"):
    return {
        "spotify_id": spotify_id,
        "name": name,
        "artist": artist,
        "album": name,
        "duration_ms": duration_ms,
    }


def candidate(video_id, title, artist, duration_seconds=180):
    return {
        "videoId": video_id,
        "title": title,
        "artists": [{"name": artist}],
        "album": {"name": title},
        "duration_seconds": duration_seconds,
        "resultType": "song",
    }


@pytest.mark.parametrize(
    ("spotify_track", "source"),
    [
        (
            track("Silence", "NVYKO", 204_000, "silence"),
            candidate("silence-video", "Silence", "NVYKO", 204),
        ),
        (
            track("Mutate", "Player Dave", 192_000, "mutate"),
            candidate("mutate-video", "Mutate", "Player Dave", 192),
        ),
    ],
)
def test_regression_exact_matches_are_verified(spotify_track, source):
    decision = evaluate_candidates(
        spotify_track, [source], resolved_at="2026-07-28T00:00:00Z"
    )

    assert decision["status"] == "verified"
    assert decision["source"]["video_id"] == source["videoId"]
    assert decision["scores"]["title_similarity"] == 1
    assert decision["scores"]["artist_similarity"] == 1
    assert decision["scores"]["duration_delta_ms"] == 0
    assert decision["scores"]["runner_up_margin"] is None
    assert decision["resolver_version"]
    assert decision["resolved_at"] == "2026-07-28T00:00:00Z"
    assert decision["audio_analysis"] == AUDIO_ANALYSIS_POLICY
    assert decision["audio_analysis"]["auto_approval"] is False


@pytest.mark.parametrize(
    ("spotify_track", "unsafe_source", "failed_gate"),
    [
        (
            track("Watch Your Thoughts", "Player Dave", 188_000, "watch"),
            candidate(
                "watch-unsafe",
                "Watch Your Thoughts",
                "Player Dave",
                224,
            ),
            "duration",
        ),
        (
            track("Wanderer", "Dirtwire", 236_000, "wanderer"),
            candidate("wanderer-live", "Wanderer (Live)", "Dirtwire", 236),
            "version",
        ),
    ],
)
def test_regression_unsafe_matches_are_rejected(
    spotify_track, unsafe_source, failed_gate
):
    decision = evaluate_candidates(spotify_track, [unsafe_source])

    assert decision["status"] == "rejected"
    assert decision["candidates"][0]["gates"][failed_gate] is False


def test_original_is_selected_over_conflicting_remix():
    spotify_track = track("When I am Gone", "Artist", 210_000, "gone")
    original = candidate("original", "When I am Gone", "Artist", 210)
    remix = candidate(
        "remix",
        "When I am Gone (Afterlife Remix)",
        "Artist",
        210,
    )

    decision = evaluate_candidates(spotify_track, [remix, original])

    assert decision["status"] == "verified"
    assert decision["source"]["video_id"] == "original"
    remix_score = next(
        item for item in decision["candidates"] if item["source"]["video_id"] == "remix"
    )
    assert remix_score["gates"]["version"] is False
    assert remix_score["eligible"] is False


def test_conflicting_remix_is_not_approved_without_an_original():
    decision = evaluate_candidates(
        track("When I am Gone", "Artist", 210_000, "gone"),
        [
            candidate(
                "remix",
                "When I am Gone (Afterlife Remix)",
                "Artist",
                210,
            )
        ],
    )

    assert decision["status"] == "rejected"


def test_equivalent_sources_prefer_the_exact_album_without_ambiguity():
    spotify_track = track("Same Song", "Same Artist")
    single_release = candidate("video-z", "Same Song", "Same Artist")
    single_release["album"]["name"] = "Same Song - Single"
    album_release = candidate("video-a", "Same Song", "Same Artist")
    decision = evaluate_candidates(
        spotify_track,
        [single_release, album_release],
    )

    assert decision["status"] == "verified"
    assert decision["source"]["video_id"] == "video-a"
    assert decision["scores"]["runner_up_margin"] == 0
    assert decision["reasons"] == ["exact_album_preferred"]


def test_materially_different_tied_sources_remain_ambiguous():
    spotify_track = track("Same Song", "Same Artist")
    decision = evaluate_candidates(
        spotify_track,
        [
            candidate("video-a", "Same Song", "Same Artist", 180),
            candidate("video-b", "Same Song", "Same Artist", 184),
        ],
    )

    assert decision["status"] == "ambiguous"
    assert decision["scores"]["runner_up_margin"] < 0.05
    assert decision["reasons"] == ["runner_up_margin_too_small"]


def test_exact_album_breaks_a_close_non_equivalent_tie():
    spotify_track = track("Same Song", "Same Artist")
    exact_album = candidate("video-a", "Same Song", "Same Artist", 180)
    compilation = candidate("video-b", "Same Song", "Same Artist", 184)
    compilation["album"]["name"] = "Various Artists Compilation"

    decision = evaluate_candidates(
        spotify_track,
        [compilation, exact_album],
    )

    assert decision["status"] == "verified"
    assert decision["source"]["video_id"] == "video-a"
    assert decision["reasons"] == ["exact_album_preferred"]


def test_source_title_feature_credit_uses_spotify_artist_metadata():
    spotify_track = track(
        "You Got Me",
        [{"name": "PEEKABOO"}, {"name": "Bill Lucas"}],
        235_893,
    )
    decision = evaluate_candidates(
        spotify_track,
        [
            candidate(
                "correct",
                "You Got Me (feat. Bill Lucas)",
                "PEEKABOO",
                236,
            )
        ],
    )

    assert decision["status"] == "verified"
    assert decision["scores"]["title_similarity"] == 1
    assert (
        decision["normalized"]["source_title_for_similarity"]
        == decision["normalized"]["spotify_title"]
    )


def test_spotify_title_with_credit_uses_shared_artist_metadata():
    spotify_track = track(
        "Of Blue (with Mereba)",
        [{"name": "JID"}, {"name": "Mereba"}],
        397_000,
    )
    source = candidate("correct", "Of Blue", "JID", 397)
    source["artists"].append({"name": "Mereba"})

    decision = evaluate_candidates(spotify_track, [source])

    assert decision["status"] == "verified"
    assert decision["scores"]["title_similarity"] == 1
    assert (
        decision["normalized"]["spotify_title_for_similarity"]
        == decision["normalized"]["source_title_for_similarity"]
        == "of blue"
    )


def test_combined_source_artist_credit_matches_primary_artist():
    spotify_track = track(
        "Swerve It",
        [
            {"name": "Bou"},
            {"name": "Camo & Krooked"},
            {"name": "Mefjus"},
        ],
        168_000,
    )
    source = candidate(
        "correct",
        "Swerve It",
        "Bou, Camo & Krooked, and Mefjus",
        168,
    )

    decision = evaluate_candidates(spotify_track, [source])

    assert decision["status"] == "verified"
    assert decision["scores"]["artist_similarity"] == 1


def test_unknown_source_title_feature_credit_is_not_stripped():
    decision = evaluate_candidates(
        track("You Got Me", "PEEKABOO", 236_000),
        [
            candidate(
                "wrong-feature",
                "You Got Me (feat. Someone Else)",
                "PEEKABOO",
                236,
            )
        ],
    )

    assert decision["status"] == "rejected"
    assert decision["candidates"][0]["gates"]["title"] is False


def test_feature_credit_does_not_hide_a_conflicting_version():
    decision = evaluate_candidates(
        track(
            "You Got Me",
            [{"name": "PEEKABOO"}, {"name": "Bill Lucas"}],
            236_000,
        ),
        [
            candidate(
                "wrong-remix",
                "You Got Me (feat. Bill Lucas) (Remix)",
                "PEEKABOO",
                236,
            )
        ],
    )

    assert decision["status"] == "rejected"
    assert decision["candidates"][0]["gates"]["version"] is False


def test_manual_approval_and_rejection_persist(tmp_path):
    store_path = tmp_path / "matches.json"
    MatchStore(store_path).approve("approved-id", "approved-video")
    MatchStore(store_path).reject("rejected-id")

    reloaded = MatchStore(store_path)
    approved = reloaded.decision_for(
        track("Approved", "Artist", spotify_id="approved-id")
    )
    rejected = reloaded.decision_for(
        track("Rejected", "Artist", spotify_id="rejected-id")
    )

    assert approved["status"] == "manual"
    assert approved["source"]["video_id"] == "approved-video"
    assert rejected["status"] == "rejected"
    assert rejected["source"] is None
    assert (
        json.loads(store_path.read_text())["overrides"]["rejected-id"]["status"]
        == "rejected"
    )


def test_multiple_decisions_persist_in_one_store_update(tmp_path):
    store_path = tmp_path / "matches.json"
    decisions = [
        evaluate_candidates(
            track("First", "Artist", spotify_id="first"),
            [candidate("first-video", "First", "Artist")],
        ),
        evaluate_candidates(
            track("Second", "Artist", spotify_id="second"),
            [candidate("second-video", "Second", "Artist")],
        ),
    ]

    MatchStore(store_path).save_decisions(decisions)
    reloaded = MatchStore(store_path)

    assert (
        reloaded.decision_for(
            track("First", "Artist", spotify_id="first")
        )["source"]["video_id"]
        == "first-video"
    )
    assert (
        reloaded.decision_for(
            track("Second", "Artist", spotify_id="second")
        )["source"]["video_id"]
        == "second-video"
    )


def test_verified_decision_is_pinned_without_searching_again(tmp_path):
    source = candidate("approved-video", "Pinned", "Artist")

    class FirstSearch:
        def search(self, query, filter):
            return [source]

    store_path = tmp_path / "matches.json"
    first = TrackResolver(MatchStore(store_path), client_factory=FirstSearch)
    assert first.resolve(track("Pinned", "Artist"))["status"] == "verified"

    def fail_if_searched():
        raise AssertionError("approved decisions must not search again")

    second = TrackResolver(MatchStore(store_path), client_factory=fail_if_searched)
    decision = second.resolve(track("Pinned", "Artist"))

    assert decision["source"]["video_id"] == "approved-video"


def test_resolver_searches_videos_after_song_results_fail_gates(tmp_path):
    correct = candidate("video-source", "Small Artist Song", "Small Artist")
    wrong = candidate("wrong-song", "Different Song", "Small Artist")

    class Search:
        def search(self, query, filter):
            return [correct] if filter == "videos" else [wrong]

    resolver = TrackResolver(
        MatchStore(tmp_path / "matches.json"),
        client_factory=Search,
    )

    decision = resolver.resolve(track("Small Artist Song", "Small Artist"))

    assert decision["status"] == "verified"
    assert decision["source"]["video_id"] == "video-source"


def test_resolver_falls_back_to_primary_artist_query(tmp_path):
    correct = candidate("primary-source", "Collaboration", "Primary Artist")
    wrong = candidate("wrong-song", "Different Song", "Primary Artist")
    queries = []

    class Search:
        def search(self, query, filter):
            queries.append((query, filter))
            if query == "Primary Artist - Collaboration" and filter == "songs":
                return [correct]
            return [wrong] if filter == "songs" else []

    resolver = TrackResolver(
        MatchStore(tmp_path / "matches.json"),
        client_factory=Search,
    )
    spotify_track = track(
        "Collaboration",
        [{"name": "Primary Artist"}, {"name": "Guest Artist"}],
    )

    decision = resolver.resolve(spotify_track)

    assert decision["status"] == "verified"
    assert decision["source"]["video_id"] == "primary-source"
    assert ("Primary Artist - Collaboration", "songs") in queries


def test_failed_optional_fallback_preserves_initial_decision(tmp_path):
    sources = [
        candidate("video-a", "Same Song", "Same Artist", 180),
        candidate("video-b", "Same Song", "Same Artist", 184),
    ]

    class Search:
        def search(self, query, filter):
            if filter == "videos":
                raise RuntimeError("optional video search failed")
            return sources

    resolver = TrackResolver(
        MatchStore(tmp_path / "matches.json"),
        client_factory=Search,
    )

    decision = resolver.resolve(track("Same Song", "Same Artist"))

    assert decision["status"] == "ambiguous"
    assert decision["reasons"] == ["runner_up_margin_too_small"]


def test_downloader_consumes_exact_approved_video_id(monkeypatch, tmp_path):
    downloaded_urls = []
    downloader_options = []

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options
            downloader_options.append(options)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            downloaded_urls.extend(urls)

    monkeypatch.setattr(youtube.yt_dlp, "YoutubeDL", FakeYoutubeDL)

    reference_file = tmp_path / "tracks.log"
    reference_file.write_text(
        "Pinned;Artist;;1;Album;None;0\n",
        encoding="utf-8",
    )
    approved = evaluate_candidates(
        track("Pinned", "Artist"),
        [candidate("approved-video", "Pinned", "Artist")],
    )

    youtube.find_and_download_songs(
        {
            "reference_file": str(reference_file),
            "track_db": [
                {
                    **track("Pinned", "Artist"),
                    "playlist_num": 1,
                    "save_path": tmp_path,
                    "match_decision": approved,
                }
            ],
            "file_name_f": youtube.default_filename,
            "use_sponsorblock": "no",
            "no_overwrites": False,
            "skip_mp3": True,
            "remove_trailing_tracks": "n",
            "format_str": "bestaudio/best",
            "proxy": "",
            "cookies_from_browser": "chrome",
            "cookies_browser_profile": "Profile 1",
        }
    )

    assert downloaded_urls == ["https://music.youtube.com/watch?v=approved-video"]
    assert downloader_options[0]["cookiesfrombrowser"] == ("chrome", "Profile 1")
    assert downloader_options[0]["retries"] == 10
    assert downloader_options[0]["fragment_retries"] == 10
    assert downloader_options[0]["extractor_retries"] == 5
    retry_sleep = downloader_options[0]["retry_sleep_functions"]
    assert retry_sleep["http"](1) == 2
    assert retry_sleep["http"](10) == 60
    assert downloader_options[0]["sleep_interval_requests"] == 1
    assert downloader_options[0]["sleep_interval"] == 1
    assert downloader_options[0]["max_sleep_interval"] == 3


def test_quoted_title_round_trips_into_download_filename(monkeypatch, tmp_path):
    title = 'What Is Love - 7" Mix'
    approved = evaluate_candidates(
        track(title, "Haddaway"),
        [candidate("approved-video", title, "Haddaway")],
    )
    spotify_track = {
        **track(title, "Haddaway"),
        "track_url": "",
        "num": 1,
        "num_tracks": 1,
        "playlist_num": 1,
        "tempo": None,
        "year": "",
        "genre": "",
        "cover": None,
        "match_decision": approved,
    }
    reference_file = tmp_path / "tracks.log"
    track_db = youtube.write_tracks(
        reference_file,
        {"urls": [{"save_path": tmp_path, "songs": [spotify_track]}]},
    )
    output_paths = []

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            output_path = self.options["outtmpl"].replace("%(ext)s", "mp3")
            output_paths.append(output_path)
            with open(output_path, "wb") as audio_file:
                audio_file.write(b"audio")

    tagged_paths = []
    monkeypatch.setattr(youtube.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    monkeypatch.setattr(
        youtube,
        "set_tags",
        lambda temp, filename, kwargs: tagged_paths.append(filename),
    )

    youtube.find_and_download_songs(
        {
            "reference_file": str(reference_file),
            "track_db": track_db,
            "file_name_f": youtube.default_filename,
            "use_sponsorblock": "no",
            "no_overwrites": False,
            "skip_mp3": False,
            "remove_trailing_tracks": "n",
            "format_str": "bestaudio/best",
            "proxy": "",
        }
    )

    expected_path = tmp_path / "Haddaway - What Is Love - 7# Mix.mp3"
    assert output_paths == [str(expected_path)]
    assert tagged_paths == [str(expected_path)]
    assert expected_path.exists()


def test_browser_cookie_spec_keeps_browser_only_configuration_compatible():
    assert youtube.browser_cookie_spec("chrome") == ("chrome",)
    assert youtube.browser_cookie_spec("chrome", "Profile 1") == (
        "chrome",
        "Profile 1",
    )
    assert youtube.browser_cookie_spec("") is None


def test_downloader_retries_same_approved_video_id_with_hls(
    monkeypatch, tmp_path
):
    attempts = []

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            attempts.append((self.options, urls))
            if len(attempts) == 1:
                raise RuntimeError("primary GVS stream rejected")

    monkeypatch.setattr(youtube.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    reference_file = tmp_path / "tracks.log"
    reference_file.write_text(
        "Pinned;Artist;;1;Album;None;0\n",
        encoding="utf-8",
    )
    approved = evaluate_candidates(
        track("Pinned", "Artist"),
        [candidate("approved-video", "Pinned", "Artist")],
    )

    youtube.find_and_download_songs(
        {
            "reference_file": str(reference_file),
            "track_db": [
                {
                    **track("Pinned", "Artist"),
                    "playlist_num": 1,
                    "save_path": tmp_path,
                    "match_decision": approved,
                }
            ],
            "file_name_f": youtube.default_filename,
            "use_sponsorblock": "no",
            "no_overwrites": False,
            "skip_mp3": True,
            "remove_trailing_tracks": "n",
            "format_str": "bestaudio/best",
            "proxy": "",
            "cookies_from_browser": "chrome",
            "cookies_browser_profile": "Profile 1",
            "youtube_hls_fallback": True,
        }
    )

    assert attempts[0][1] == [
        "https://music.youtube.com/watch?v=approved-video"
    ]
    assert attempts[1][1] == [
        "https://www.youtube.com/watch?v=approved-video"
    ]
    assert attempts[1][0]["format"] == youtube.HLS_FALLBACK_FORMAT
    assert attempts[1][0]["extractor_args"] == {
        "youtube": {"player_client": ["web_safari"]}
    }


def test_downloader_can_prefer_hls_before_audio_only(monkeypatch, tmp_path):
    attempts = []

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            attempts.append((self.options, urls))

    monkeypatch.setattr(youtube.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    reference_file = tmp_path / "tracks.log"
    reference_file.write_text(
        "Pinned;Artist;;1;Album;None;0\n",
        encoding="utf-8",
    )
    approved = evaluate_candidates(
        track("Pinned", "Artist"),
        [candidate("approved-video", "Pinned", "Artist")],
    )

    youtube.find_and_download_songs(
        {
            "reference_file": str(reference_file),
            "track_db": [
                {
                    **track("Pinned", "Artist"),
                    "playlist_num": 1,
                    "save_path": tmp_path,
                    "match_decision": approved,
                }
            ],
            "file_name_f": youtube.default_filename,
            "use_sponsorblock": "no",
            "no_overwrites": False,
            "skip_mp3": True,
            "remove_trailing_tracks": "n",
            "proxy": "",
            "youtube_hls_preferred": True,
        }
    )

    assert len(attempts) == 1
    assert attempts[0][1] == [
        "https://www.youtube.com/watch?v=approved-video"
    ]
    assert attempts[0][0]["format"] == youtube.HLS_FALLBACK_FORMAT


def test_downloader_uses_cookie_free_same_id_progressive_fallback(
    monkeypatch, tmp_path
):
    attempts = []

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            attempts.append((self.options, urls))
            if len(attempts) < 3:
                raise RuntimeError("stream unavailable")

    monkeypatch.setattr(youtube.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    reference_file = tmp_path / "tracks.log"
    reference_file.write_text(
        "Pinned;Artist;;1;Album;None;0\n",
        encoding="utf-8",
    )
    approved = evaluate_candidates(
        track("Pinned", "Artist"),
        [candidate("approved-video", "Pinned", "Artist")],
    )

    youtube.find_and_download_songs(
        {
            "reference_file": str(reference_file),
            "track_db": [
                {
                    **track("Pinned", "Artist"),
                    "playlist_num": 1,
                    "save_path": tmp_path,
                    "match_decision": approved,
                }
            ],
            "file_name_f": youtube.default_filename,
            "use_sponsorblock": "no",
            "no_overwrites": False,
            "skip_mp3": True,
            "remove_trailing_tracks": "n",
            "proxy": "",
            "cookies_from_browser": "chrome",
            "cookies_browser_profile": "Profile 1",
            "youtube_hls_fallback": True,
            "youtube_progressive_fallback": True,
        }
    )

    assert [attempt[1] for attempt in attempts] == [
        ["https://music.youtube.com/watch?v=approved-video"],
        ["https://www.youtube.com/watch?v=approved-video"],
        ["https://www.youtube.com/watch?v=approved-video"],
    ]
    progressive_options = attempts[2][0]
    assert "cookiesfrombrowser" not in progressive_options
    assert progressive_options["format"] == youtube.PROGRESSIVE_FALLBACK_FORMAT
    assert progressive_options["extractor_args"] == {
        "youtube": {"player_client": ["android_vr"]}
    }


def test_downloader_never_downloads_rejected_decision(monkeypatch, tmp_path):
    class FailYoutubeDL:
        def __init__(self, options):
            raise AssertionError("rejected matches must not reach yt-dlp")

    monkeypatch.setattr(youtube.yt_dlp, "YoutubeDL", FailYoutubeDL)
    reference_file = tmp_path / "tracks.log"
    reference_file.write_text("Unsafe;Artist;;1;Album;None;0\n", encoding="utf-8")
    rejected = evaluate_candidates(
        track("Unsafe", "Artist"),
        [candidate("wrong", "Different", "Someone Else", 400)],
    )

    youtube.find_and_download_songs(
        {
            "reference_file": str(reference_file),
            "track_db": [
                {
                    **track("Unsafe", "Artist"),
                    "playlist_num": 1,
                    "save_path": tmp_path,
                    "match_decision": rejected,
                }
            ],
            "file_name_f": youtube.default_filename,
            "use_sponsorblock": "no",
            "no_overwrites": False,
            "skip_mp3": True,
            "remove_trailing_tracks": "n",
            "proxy": "",
        }
    )
