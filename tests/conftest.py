import pytest

from spotify_dl import rekordbox, web


@pytest.fixture(autouse=True)
def _clear_rekordbox_caches():
    """load_tracks(), file_state() and the not-imported count all memoize across
    calls. Without this, one test's stubbed collection leaks into the next one's,
    and a test that stubs open_db can silently assert against rows a previous
    test loaded."""
    def clear():
        rekordbox.invalidate_tracks_cache()
        rekordbox._PRESENCE_CACHE.clear()
        web.invalidate_not_imported_cache()

    clear()
    yield
    clear()
