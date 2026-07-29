from spotify_dl.spotify import fetch_tracks


def test_playlist_tracks_include_duration_for_source_matching():
    class Spotify:
        def playlist_items(self, **kwargs):
            assert "items.track.duration_ms" in kwargs["fields"]
            return {
                "total": 1,
                "items": [
                    {
                        "track": {
                            "id": "spotify-id",
                            "name": "Track",
                            "duration_ms": 183_456,
                            "track_number": 1,
                            "artists": [{"name": "Artist"}],
                            "album": {
                                "name": "Album",
                                "release_date": "2026-01-01",
                                "total_tracks": 1,
                                "images": [],
                            },
                        }
                    }
                ],
            }

    songs = fetch_tracks(Spotify(), "playlist", "playlist-id")

    assert songs[0]["duration_ms"] == 183_456
