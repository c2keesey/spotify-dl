import pytest

from spotify_dl import rekordbox


@pytest.fixture(autouse=True)
def _clear_rekordbox_caches():
    """load_tracks() and file_state() memoize across calls. Without this, one
    test's stubbed collection leaks into the next one's, and a test that stubs
    open_db can silently assert against rows a previous test loaded."""
    rekordbox.invalidate_tracks_cache()
    rekordbox._PRESENCE_CACHE.clear()
    yield
    rekordbox.invalidate_tracks_cache()
    rekordbox._PRESENCE_CACHE.clear()
