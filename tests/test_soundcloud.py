from spotify_dl.soundcloud import is_soundcloud_url


def test_detects_track_url():
    assert is_soundcloud_url("https://soundcloud.com/forss/flickermood")


def test_detects_set_url():
    assert is_soundcloud_url("https://soundcloud.com/user/sets/some-playlist?si=abc")


def test_detects_share_link():
    assert is_soundcloud_url("https://on.soundcloud.com/AbC123")


def test_detects_mobile_url():
    assert is_soundcloud_url("https://m.soundcloud.com/forss/flickermood")


def test_rejects_spotify_url():
    assert not is_soundcloud_url("https://open.spotify.com/playlist/7rtZbbpOqGPRf9GQKt2jGN")


def test_rejects_lookalike_domain():
    assert not is_soundcloud_url("https://soundcloud.com.evil.example/track")
