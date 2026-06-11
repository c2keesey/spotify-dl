from pathlib import Path
from urllib.parse import urlparse

import yt_dlp

from spotify_dl.scaffold import log
from spotify_dl.utils import sanitize

SOUNDCLOUD_HOSTS = ("soundcloud.com", "www.soundcloud.com", "on.soundcloud.com", "m.soundcloud.com")


def is_soundcloud_url(url):
    """
    Check whether the URL points to SoundCloud (track, set/playlist, or share link).
    """
    return urlparse(url).netloc.lower() in SOUNDCLOUD_HOSTS


def download_soundcloud(url, output_dir, skip_mp3=False, no_overwrites=False, proxy=""):
    """
    Download a SoundCloud track or set/playlist using yt-dlp directly.
    SoundCloud provides its own audio and metadata, so unlike Spotify URLs
    there is no YouTube search step. Playlists are saved to a folder named
    after the set; single tracks are saved directly into output_dir.
    """
    info_opts = {
        "quiet": True,
        "extract_flat": "in_playlist",
        "proxy": proxy or None,
    }
    with yt_dlp.YoutubeDL(info_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get("_type") == "playlist":
        save_dir = Path(output_dir) / sanitize(info.get("title") or "soundcloud-playlist")
        track_count = len(info.get("entries") or [])
        log.info("Saving %d SoundCloud tracks to %s directory", track_count, save_dir.name)
    else:
        save_dir = Path(output_dir)
        log.info("Saving SoundCloud track %s to %s", info.get("title"), save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(save_dir / "%(uploader)s - %(title)s.%(ext)s"),
        "noplaylist": False,
        # archive file makes re-runs skip already-downloaded tracks (the final
        # mp3 can't be detected by yt-dlp since the source file gets converted)
        "download_archive": str(save_dir / ".sc_archive.txt") if no_overwrites else None,
        "proxy": proxy or None,
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ],
        "ignoreerrors": True,  # keep going if one track in a set fails
    }
    if not skip_mp3:
        ydl_opts["postprocessors"].insert(
            0,
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            },
        )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
