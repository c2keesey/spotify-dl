"""Minimal localhost web UI: paste links to download, view crons.

Run with `uv run spotify-dl-ui`. Downloads run the CLI as a subprocess so the
web layer stays a thin shell over the exact same code path as the terminal.
"""

import functools
import hashlib
import itertools
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
import webbrowser
from collections import OrderedDict
from pathlib import Path

import spotipy
import uvicorn
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from spotipy.exceptions import SpotifyException
from spotipy.oauth2 import SpotifyClientCredentials

from spotify_dl import dj, rekordbox, setfile
from spotify_dl.spotify import get_item_name

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"
DEFAULT_OUTPUT = REPO_ROOT / "downloads"
SETS_DIR = REPO_ROOT / "sets"
PORT = 8765

app = FastAPI(title="spotify-dl")

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

TOTAL_RE = re.compile(r"^Total songs: (\d+)")
SC_SET_RE = re.compile(r"Saving (\d+) SoundCloud tracks")
SC_TRACK_RE = re.compile(r"Saving SoundCloud track ")
TRACK_START_RE = re.compile(r"^Initiating download for (.+)\.$")
TRACK_DONE_RE = re.compile(
    r"\[ExtractAudio\] Destination: "
    r"|already exists, we do not overwrite"
    r"|Recovered .* from orphan WebM"
)
TRACK_FAIL_RE = re.compile(r"^Failed to download:?\s+(.+?)(?:,\s*(?:make sure|please ensure)\b.*)?$")
NO_MATCH_RE = re.compile(r"No (?:valid )?search results.*?\bfor (.+?),")
PCT_RE = re.compile(r"\[download\]\s+([\d.]+)% of")

jobs = {}
job_ids = itertools.count(1)
jobs_lock = threading.Lock()


class DownloadRequest(BaseModel):
    urls: list[str]
    output: str = ""


def _mp3_set(output):
    """Absolute paths of every mp3 currently under `output` (empty if not a
    dir). Used to diff before/after a download so auto-import sees only the
    files THIS job produced, not the whole (possibly huge) downloads tree."""
    p = Path(output)
    if not p.is_dir():
        return set()
    return {str(f) for f in p.rglob("*.mp3")}


def run_job(job):
    try:
        job["meta"] = [resolve_link(u) for u in job["urls"]]
    except Exception:  # noqa: BLE001 - labels are best-effort, never block a download
        job["meta"] = []
    env = {**dict(dotenv_values(REPO_ROOT / ".env")), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HOME": str(Path.home())}
    cmd = [
        sys.executable, "-m", "spotify_dl.spotify_dl",
        "-l", *job["urls"],
        "-o", job["output"],
        "-mc", "4",
        "-w",
    ]
    try:
        before = _mp3_set(job["output"])
        proc = subprocess.Popen(
            cmd, cwd=REPO_ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        for line in proc.stdout:
            job["log"].append(ANSI_RE.sub("", line.rstrip("\n")))
        proc.wait()
        job["status"] = "done" if proc.returncode == 0 else "failed"
        try:
            record_sources(job)
        except Exception:  # noqa: BLE001 - source mapping is best-effort
            pass
        if job["status"] == "done":
            produced = sorted(_mp3_set(job["output"]) - before)
            try:
                auto_import(job["output"], produced)
            except Exception:  # noqa: BLE001 - rekordbox import must never fail a download
                pass
    except Exception as e:  # noqa: BLE001 - surface anything to the UI
        job["log"].append(f"error: {e}")
        job["status"] = "failed"


@app.post("/api/download")
def start_download(req: DownloadRequest):
    urls = [u.strip() for u in req.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "no urls")
    output = resolve_output(req.output)
    job = {
        "id": next(job_ids),
        "urls": urls,
        "output": output,
        "status": "running",
        "log": [],
        "meta": [],
    }
    with jobs_lock:
        jobs[job["id"]] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return {"id": job["id"]}


def parse_progress(log):
    """Derive structured progress from the CLI's log lines. With -mc the
    workers' output interleaves, so counts are exact but `current` is just
    the most recently started track."""
    total = done = 0
    current = ""
    pct = 0.0
    failed_tracks = []      # download failures (may be transient — worth a retry)
    unmatched_tracks = []   # no YouTube result (deterministic — a retry won't help)
    for line in log:
        if m := TOTAL_RE.match(line):
            total += int(m.group(1))
        elif m := SC_SET_RE.search(line):
            total += int(m.group(1))
        elif SC_TRACK_RE.search(line):
            total += 1
        elif m := TRACK_START_RE.match(line):
            current = m.group(1)
            pct = 0.0
        elif TRACK_DONE_RE.search(line):
            done += 1
        elif m := TRACK_FAIL_RE.match(line):
            failed_tracks.append(m.group(1).strip())
        elif m := NO_MATCH_RE.search(line):
            unmatched_tracks.append(m.group(1).strip())
        elif m := PCT_RE.search(line):
            pct = float(m.group(1))

    def _dedup(names):
        seen, out = set(), []
        for n in names:
            if n and n not in seen:
                seen.add(n)
                out.append(n)
        return out

    # tracks that didn't make it: everything counted but not finished
    missing = max(0, total - done) if total else len(failed_tracks) + len(unmatched_tracks)
    unmatched = _dedup(unmatched_tracks)
    unmatched_set = set(unmatched)
    failed = [n for n in _dedup(failed_tracks) if n not in unmatched_set]
    return {"total": total, "done": done, "failed": missing, "current": current,
            "pct": pct, "failed_tracks": failed, "unmatched": unmatched}


def summarize_error(log):
    """Turn a failed job's log into one plain-English line. Known failure
    classes get specific messages; otherwise fall back to the last error-ish
    line so the row is never just a bare 'Failed'."""
    text = "\n".join(log)
    if "Resource not found" in text and "playlists/37i9" in text:
        return "Spotify no longer allows downloading its editorial playlists (the 37i9… ones). Try one you made yourself."
    if "Resource not found" in text or "http status: 404" in text:
        return "Spotify couldn't find one of these items — it may be private, deleted, or region-locked."
    if "Signature solving failed" in text or "Failed to extract any player response" in text:
        return "YouTube blocked the download — yt-dlp may need updating, and deno must be installed."
    if "client_id" in text and "None" in text:
        return "Spotify credentials missing or invalid — check your .env file."
    for line in reversed(log):
        s = line.strip()
        if s and ("Error" in s or "Exception" in s) and not s.startswith("Traceback"):
            return s[:200]
    return None


@app.post("/api/jobs/{job_id}/retry")
def retry_job(job_id: int):
    """Re-run a finished job's links. Because downloads use -w (no-overwrite),
    tracks already on disk are skipped, so this only re-attempts the ones that
    didn't make it the first time."""
    with jobs_lock:
        orig = jobs.get(job_id)
        if not orig:
            raise HTTPException(404, "no such job")
        if orig["status"] == "running":
            raise HTTPException(409, "job is still running")
        job = {
            "id": next(job_ids),
            "urls": orig["urls"],
            "output": orig["output"],
            "status": "running",
            "log": [],
            "meta": orig.get("meta", []),
        }
        jobs[job["id"]] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return {"id": job["id"]}


@app.get("/api/jobs")
def list_jobs():
    return [
        {
            "id": j["id"],
            "urls": j["urls"],
            "output": j["output"],
            "status": j["status"],
            "meta": j.get("meta", []),
            "progress": parse_progress(j["log"]),
            "error": summarize_error(j["log"]) if j["status"] == "failed" else None,
        }
        for j in sorted(jobs.values(), key=lambda j: -j["id"])
    ]


# ---- link preview ----

SPOTIFY_URL_RE = re.compile(
    r"open\.spotify\.com/(?:intl-[a-z]+/)?(track|album|playlist)/([A-Za-z0-9]+)"
)


@functools.lru_cache(maxsize=1)
def spotify_client():
    """Lazily built, credentials-only Spotify client (no user auth needed for
    public metadata). Cached so preview calls don't re-auth each time."""
    creds = dict(dotenv_values(REPO_ROOT / ".env"))
    cid = creds.get("SPOTIPY_CLIENT_ID") or os.environ.get("SPOTIPY_CLIENT_ID")
    secret = creds.get("SPOTIPY_CLIENT_SECRET") or os.environ.get("SPOTIPY_CLIENT_SECRET")
    if not cid or not secret:
        raise RuntimeError("missing-credentials")
    return spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(client_id=cid, client_secret=secret)
    )


def _spotify_preview(kind, item_id):
    sp = spotify_client()
    if kind == "track":
        t = sp.track(item_id)
        imgs = t["album"]["images"]
        artists = ", ".join(a["name"] for a in t["artists"])
        return {"name": f"{artists} — {t['name']}", "image": imgs[0]["url"] if imgs else None, "count": 1}
    if kind == "album":
        a = sp.album(item_id)
        return {"name": a["name"], "image": a["images"][0]["url"] if a["images"] else None, "count": a["total_tracks"]}
    p = sp.playlist(item_id, fields="name,images,tracks.total")
    imgs = p.get("images") or []
    return {"name": p["name"], "image": imgs[0]["url"] if imgs else None, "count": p["tracks"]["total"]}


def _spotify_preview_error(kind, item_id, exc):
    status = getattr(exc, "http_status", None)
    if status == 404:
        if kind == "playlist" and item_id.startswith("37i9"):
            return "Spotify no longer allows downloading its editorial playlists (the 37i9… ones)."
        return f"Spotify couldn't find this {kind} — it may be private, deleted, or region-locked."
    if status in (401, 403):
        return "Spotify rejected the request — check your API credentials."
    return "Couldn't load this link from Spotify."


def resolve_link(url):
    """Resolve a link to {url, kind, name, image, count, error}. Used both for
    live previews and to label download jobs with a name + cover."""
    url = url.strip()
    m = SPOTIFY_URL_RE.search(url)
    if m:
        kind, item_id = m.group(1), m.group(2)
        base = {"url": url, "kind": kind, "name": None, "image": None, "count": None, "error": None}
        try:
            return {**base, **_spotify_preview(kind, item_id)}
        except RuntimeError:
            return {**base, "error": "Spotify credentials missing — add them to .env."}
        except SpotifyException as e:
            return {**base, "error": _spotify_preview_error(kind, item_id, e)}
        except Exception:  # noqa: BLE001 - any metadata failure becomes a friendly note
            return {**base, "error": "Couldn't load this link."}
    if "soundcloud.com" in url:
        name = url.split("soundcloud.com/", 1)[-1].strip("/") or "SoundCloud"
        return {"url": url, "kind": "soundcloud", "name": name, "image": None, "count": None, "error": None}
    return {"url": url, "kind": None, "name": None, "image": None, "count": None,
            "error": "Not a Spotify or SoundCloud link."}


@app.get("/api/preview")
def preview(url: str = ""):
    """Resolve a single link so the UI can show what will be downloaded — and
    flag dead links — before submitting."""
    if not url.strip():
        raise HTTPException(400, "no url")
    return resolve_link(url)


# ---- source mapping (folder -> link, for library sync) ----

SOURCES_FILE = ".spotify_dl_sources.json"


def folder_for_url(url):
    """The on-disk folder name a Spotify link downloads into — computed with the
    same naming the downloader uses, so it matches exactly. None for SoundCloud
    or anything without its own folder."""
    m = SPOTIFY_URL_RE.search(url)
    if not m:
        return None
    kind, item_id = m.group(1), m.group(2)
    try:
        return get_item_name(spotify_client(), kind, item_id)
    except Exception:  # noqa: BLE001 - best-effort; unknown folder just isn't syncable
        return None


def _load_sources(output):
    try:
        return json.loads((Path(output) / SOURCES_FILE).read_text())
    except (OSError, ValueError):
        return {}


def record_sources(job):
    """Remember which link produced each folder so the library can re-sync it."""
    output = job["output"]
    mapping = _load_sources(output)
    changed = False
    for url in job["urls"]:
        folder = folder_for_url(url)
        if folder and (Path(output) / folder).is_dir() and mapping.get(folder) != url:
            mapping[folder] = url
            changed = True
    if changed:
        try:
            (Path(output) / SOURCES_FILE).write_text(json.dumps(mapping, indent=2))
        except OSError:
            pass


# ---- output paths & external drives ----

def detect_external_drives():
    """Mounted volumes on a different device than the boot disk — i.e. real
    external / USB / network drives, not the internal SSD."""
    vols = Path("/Volumes")
    if not vols.is_dir():
        return []
    try:
        root_dev = os.stat("/").st_dev
    except OSError:
        return []
    drives = []
    for v in sorted(vols.iterdir(), key=lambda c: c.name.lower()):
        try:
            if v.is_dir() and os.stat(v).st_dev != root_dev and os.access(v, os.W_OK):
                drives.append(str(v))
        except OSError:
            continue
    return drives


def default_output():
    """Prefer the first external drive if one is mounted, else ./downloads."""
    drives = detect_external_drives()
    return drives[0] if drives else str(DEFAULT_OUTPUT)


def resolve_output(raw):
    raw = raw.strip()
    path = Path(raw).expanduser() if raw else Path(default_output())
    if not path.is_absolute():
        path = REPO_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


@app.get("/api/config")
def config():
    places = [{"label": "Home", "path": str(Path.home())}]
    for d in detect_external_drives():
        places.append({"label": Path(d).name, "path": d})
    places.append({"label": "Downloads", "path": str(DEFAULT_OUTPUT)})
    return {"default_output": default_output(), "places": places}


@app.get("/api/browse")
def browse(path: str = ""):
    p = Path(path).expanduser() if path.strip() else Path(default_output())
    try:
        p = p.resolve()
    except OSError:
        p = Path.home()
    if not p.is_dir():
        p = Path.home()
    dirs = []
    try:
        for child in sorted(p.iterdir(), key=lambda c: c.name.lower()):
            try:
                if child.is_dir() and not child.name.startswith("."):
                    dirs.append(child.name)
            except OSError:
                continue
    except (PermissionError, OSError):
        pass
    return {
        "path": str(p),
        "parent": str(p.parent) if str(p.parent) != str(p) else None,
        "dirs": dirs,
    }


# ---- library ----

@app.get("/api/library")
def library(path: str = ""):
    """List what's been downloaded in an output folder: each subfolder with its
    mp3 count, plus loose mp3s at the top level."""
    p = Path(path).expanduser() if path.strip() else Path(default_output())
    try:
        p = p.resolve()
    except OSError:
        p = DEFAULT_OUTPUT
    folders, loose = [], 0
    if p.is_dir():
        sources = _load_sources(p)
        try:
            for child in sorted(p.iterdir(), key=lambda c: c.name.lower()):
                try:
                    if child.is_dir() and not child.name.startswith("."):
                        tracks = sum(1 for _ in child.rglob("*.mp3"))
                        folders.append({"name": child.name, "path": str(child),
                                        "tracks": tracks, "url": sources.get(child.name)})
                    elif child.suffix.lower() == ".mp3":
                        loose += 1
                except OSError:
                    continue
        except (PermissionError, OSError):
            pass
    return {"path": str(p), "folders": folders, "loose": loose}


class RevealRequest(BaseModel):
    path: str


@app.post("/api/reveal")
def reveal(req: RevealRequest):
    """Open a folder in the OS file browser (Finder on macOS)."""
    p = Path(req.path).expanduser()
    if not p.exists():
        raise HTTPException(404, "no such path")
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen([opener, str(p)])
    return {"ok": True}


class PickFolderRequest(BaseModel):
    start: str = ""


@app.post("/api/pick-folder")
def pick_folder(req: PickFolderRequest):
    """Open the native macOS 'Choose Folder' dialog and return the chosen path.
    Works because the server runs locally on the user's Mac. The path is passed
    to AppleScript as an argument (not interpolated) so it's injection-safe."""
    if sys.platform != "darwin":
        raise HTTPException(501, "native folder picker is only available on macOS")
    start = req.start.strip()
    if not start or not Path(start).expanduser().is_dir():
        start = default_output()
    start = str(Path(start).expanduser())
    cmd = ["osascript"]
    for line in (
        "on run argv",
        "set startPath to item 1 of argv",
        'POSIX path of (choose folder with prompt "Choose a download folder" '
        "default location (POSIX file startPath))",
        "end run",
    ):
        cmd += ["-e", line]
    cmd.append(start.rstrip("/") + "/")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "folder picker timed out")
    if result.returncode != 0:
        if "User canceled" in result.stderr or "-128" in result.stderr:
            return {"cancelled": True}
        raise HTTPException(500, result.stderr.strip() or "folder picker failed")
    path = result.stdout.strip().rstrip("/")
    return {"cancelled": False, "path": path or default_output()}


# ---- crons ----

WEB_CRON = str(REPO_ROOT / "web_cron.sh")
DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
CRON_FIELD_RE = re.compile(r"^[\d*/,\-]+$")


class CronRequest(BaseModel):
    urls: list[str]
    output: str = ""
    freq: str = "daily"   # daily | weekly | hourly
    hour: int = 3
    minute: int = 0
    dow: int = 0          # 0=Sunday (weekly only)
    every: int = 6        # every N hours (hourly only)


def _read_crontab():
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    return result.stdout.splitlines() if result.returncode == 0 else []


def _write_crontab(lines):
    subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", text=True, check=True)


def _parse_cron_line(line):
    """(enabled, schedule, command) if line is a spotify-dl cron, else None.
    Handles both active lines and commented-out (disabled) ones."""
    stripped = line.strip()
    if not stripped:
        return None
    enabled = not stripped.startswith("#")
    body = stripped if enabled else stripped.lstrip("#").strip().removeprefix("DISABLED:").strip()
    parts = body.split(None, 5)
    if len(parts) < 6 or not CRON_FIELD_RE.match(parts[0]):
        return None
    schedule, command = " ".join(parts[:5]), parts[5]
    if "spotify-dl" not in command and "spotify_dl" not in command:
        return None
    return enabled, schedule, command


def _cron_id(schedule, command):
    return hashlib.sha1(f"{schedule} {command}".encode()).hexdigest()[:12]


def _friendly(schedule):
    parts = schedule.split()
    if len(parts) != 5:
        return schedule
    minute, hour, dom, mon, dow = parts

    def clock(h, m):
        h, m = int(h), int(m)
        return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"

    if dom == mon == "*":
        if dow == "*" and minute.isdigit() and hour.isdigit():
            return f"Daily at {clock(hour, minute)}"
        if dow.isdigit() and minute.isdigit() and hour.isdigit():
            return f"Weekly on {DOW_NAMES[int(dow) % 7]} at {clock(hour, minute)}"
        if hour.startswith("*/") and hour[2:].isdigit() and minute == "0":
            return f"Every {hour[2:]} hours"
    return schedule


def _schedule_fields(schedule):
    """Inverse of _build_schedule: turn a cron schedule back into the UI's
    {freq, hour, minute, dow, every} so an existing schedule can be edited."""
    parts = schedule.split()
    if len(parts) != 5:
        return None
    minute, hour, dom, mon, dow = parts
    if dom == mon == "*":
        if dow == "*" and minute.isdigit() and hour.isdigit():
            return {"freq": "daily", "hour": int(hour), "minute": int(minute)}
        if dow.isdigit() and minute.isdigit() and hour.isdigit():
            return {"freq": "weekly", "hour": int(hour), "minute": int(minute), "dow": int(dow)}
        if hour.startswith("*/") and hour[2:].isdigit() and minute == "0":
            return {"freq": "hourly", "every": int(hour[2:])}
    return None


def _parse_managed(command):
    """web_cron.sh <output> <url...> -> (output, [urls]) or None."""
    try:
        argv = shlex.split(command)
    except ValueError:
        return None
    if not argv or "web_cron.sh" not in argv[0] or len(argv) < 2:
        return None
    return argv[1], argv[2:]


def _build_schedule(req):
    if req.freq == "daily":
        return f"{req.minute} {req.hour} * * *"
    if req.freq == "weekly":
        return f"{req.minute} {req.hour} * * {req.dow % 7}"
    if req.freq == "hourly":
        return f"0 */{max(1, min(23, req.every))} * * *"
    raise HTTPException(400, "bad freq")


@app.get("/api/crons")
def list_crons():
    entries = []
    for line in _read_crontab():
        parsed = _parse_cron_line(line)
        if not parsed:
            continue
        enabled, schedule, command = parsed
        managed = "web_cron.sh" in command
        item = {
            "id": _cron_id(schedule, command),
            "schedule": schedule,
            "friendly": _friendly(schedule),
            "enabled": enabled,
            "managed": managed,
            "command": command,
        }
        if managed and (pm := _parse_managed(command)):
            output, urls = pm
            item.update(output=output, label=Path(output).name or output, urls=urls,
                        fields=_schedule_fields(schedule))
        entries.append(item)
    return entries


@app.post("/api/crons")
def create_cron(req: CronRequest):
    urls = [u.strip() for u in req.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "no urls")
    output = resolve_output(req.output)
    schedule = _build_schedule(req)
    command = shlex.join([WEB_CRON, output, *urls])
    lines = _read_crontab()
    lines.append(f"{schedule} {command}")
    _write_crontab(lines)
    return {"id": _cron_id(schedule, command)}


@app.put("/api/crons/{cron_id}")
def update_cron(cron_id: str, req: CronRequest):
    """Replace an existing managed schedule in place, preserving its enabled/
    disabled state. Returns the new id (it changes since id hashes the line)."""
    urls = [u.strip() for u in req.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "no urls")
    output = resolve_output(req.output)
    schedule = _build_schedule(req)
    command = shlex.join([WEB_CRON, output, *urls])
    lines = _read_crontab()
    for i, line in enumerate(lines):
        parsed = _parse_cron_line(line)
        if parsed and _cron_id(parsed[1], parsed[2]) == cron_id:
            if "web_cron.sh" not in parsed[2]:
                raise HTTPException(400, "only schedules created here can be edited")
            new_line = f"{schedule} {command}"
            lines[i] = new_line if parsed[0] else "# " + new_line
            _write_crontab(lines)
            return {"id": _cron_id(schedule, command)}
    raise HTTPException(404, "no such cron")


@app.post("/api/crons/{cron_id}/toggle")
def toggle_cron(cron_id: str):
    lines = _read_crontab()
    for i, line in enumerate(lines):
        parsed = _parse_cron_line(line)
        if parsed and _cron_id(parsed[1], parsed[2]) == cron_id:
            if parsed[0]:  # enabled -> comment out
                lines[i] = "# " + line.strip()
            else:          # disabled -> uncomment
                lines[i] = line.strip().lstrip("#").strip().removeprefix("DISABLED:").strip()
            _write_crontab(lines)
            return {"enabled": not parsed[0]}
    raise HTTPException(404, "no such cron")


@app.delete("/api/crons/{cron_id}")
def delete_cron(cron_id: str):
    lines = _read_crontab()
    kept, found = [], False
    for line in lines:
        parsed = _parse_cron_line(line)
        if parsed and _cron_id(parsed[1], parsed[2]) == cron_id:
            if "web_cron.sh" not in parsed[2]:
                raise HTTPException(400, "only schedules created here can be deleted")
            found = True
            continue
        kept.append(line)
    if not found:
        raise HTTPException(404, "no such cron")
    _write_crontab(kept)
    return {"ok": True}


# ---- dj / sets ----

def _dj_tracks_or_503():
    try:
        return rekordbox.load_tracks()
    except Exception as e:  # noqa: BLE001 - surface db problems as service-unavailable
        raise HTTPException(503, f"couldn't read rekordbox database: {e}")


# not_imported must reflect what an import would ACTUALLY add, so it runs the
# same fuzzy dedup the importer does (find_duplicates + intra-batch pass), not a
# naive exact-path compare — otherwise a file that always skips as a fuzzy dupe
# keeps the "Import N" button alive forever. The exact-path check inside
# find_duplicates is the cheap pre-filter: already-imported files cost no tag
# read. Only genuinely-new-or-fuzzy files are tag-read, and the result is cached
# per folder with a short TTL so the 5s status poll doesn't re-read ID3 tags
# every time.
_NOT_IMPORTED_CACHE = OrderedDict()   # folder path -> (count, monotonic timestamp)
_NOT_IMPORTED_TTL = 30.0
_NOT_IMPORTED_MAX = 32                # the key is a user-supplied path; keep it bounded
_NOT_IMPORTED_LOCK = threading.Lock()


def _count_not_imported(folder, tracks):
    key = str(folder)
    now = time.monotonic()
    with _NOT_IMPORTED_LOCK:
        hit = _NOT_IMPORTED_CACHE.get(key)
        if hit and now - hit[1] < _NOT_IMPORTED_TTL:
            _NOT_IMPORTED_CACHE.move_to_end(key)
            return hit[0]
    files = [str(f) for f in folder.rglob("*.mp3")]
    new, _dupes = rekordbox.find_duplicates(files, tracks)
    accepted, _batch_dupes = rekordbox._dedup_within_batch(new)
    count = len(accepted)
    with _NOT_IMPORTED_LOCK:
        _NOT_IMPORTED_CACHE[key] = (count, now)
        _NOT_IMPORTED_CACHE.move_to_end(key)
        while len(_NOT_IMPORTED_CACHE) > _NOT_IMPORTED_MAX:
            _NOT_IMPORTED_CACHE.popitem(last=False)
    return count


@app.get("/api/dj/status")
def dj_status(path: str = ""):
    """Rekordbox state + analysis counts. Drives the tab's status banner."""
    tracks = _dj_tracks_or_503()
    running = rekordbox.is_rekordbox_running()
    not_imported = 0
    p = Path(path).expanduser() if path.strip() else None
    if p and p.is_dir():
        not_imported = _count_not_imported(p, tracks)
    return {
        "running": running,
        "can_write": not running,
        "analyzed": sum(1 for t in tracks if t["status"] == "analyzed"),
        "pending": sum(1 for t in tracks if t["status"] == "pending"),
        "not_imported": not_imported,
        "missing": sum(1 for t in tracks if t["file_state"] == "missing"),
        "unmounted": sum(1 for t in tracks if t["file_state"] == "unmounted"),
        "not_a_file": sum(1 for t in tracks if t["file_state"] == "not_a_file"),
    }


@app.get("/api/dj/tracks")
def dj_tracks(bpm_min: float = 0, bpm_max: float = 0, camelot: str = "",
              q: str = "", genre: str = "", file_state: str = ""):
    tracks = _dj_tracks_or_503()
    if bpm_min:
        tracks = [t for t in tracks if t["bpm"] and t["bpm"] >= bpm_min]
    if bpm_max:
        tracks = [t for t in tracks if t["bpm"] and t["bpm"] <= bpm_max]
    if camelot:
        tracks = [t for t in tracks if t["camelot"] == camelot.upper()]
    if q.strip():
        needle = q.strip().lower()
        tracks = [t for t in tracks
                  if needle in t["title"].lower() or needle in t["artist"].lower()]
    if genre.strip():
        tracks = [t for t in tracks if (t["genre"] or "") == genre.strip()]
    if file_state.strip():
        tracks = [t for t in tracks if t["file_state"] == file_state.strip()]
    return {"tracks": tracks}


@app.get("/api/dj/duplicates")
def dj_duplicates():
    """Duplicate candidate groups in the collection — the review artifact for the
    original complaint (duplicate files in rekordbox). Read-only: reads the DB
    and reuses find_duplicates' matching, never re-reading ID3 tags, so it works
    while rekordbox is running. Crate deletes nothing here; the user selects
    copies and exports them to a NEW playlist she deletes by hand in rekordbox."""
    groups = rekordbox.group_duplicates(_dj_tracks_or_503())
    return {
        "groups": groups,
        "exact_count": sum(1 for g in groups if g["reason"] == "exact_path"),
        "fuzzy_count": sum(1 for g in groups if g["reason"] == "fuzzy"),
    }


class DJImportRequest(BaseModel):
    path: str


class DJIdsRequest(BaseModel):
    ids: list[str]


class DJExportRequest(BaseModel):
    name: str
    ids: list[str]


@app.post("/api/dj/import")
def dj_import(req: DJImportRequest):
    """Dedup-first import of a folder's mp3s into the rekordbox collection.
    Called automatically after downloads; exposed for manual re-runs."""
    p = Path(req.path).expanduser()
    if not p.is_dir():
        raise HTTPException(400, "no such folder")
    files = sorted(str(f) for f in p.rglob("*.mp3"))
    try:
        return rekordbox.import_files(files)
    except rekordbox.RekordboxRunning:
        raise HTTPException(409, "close rekordbox first")


@app.post("/api/dj/compatibility")
def dj_compatibility(req: DJIdsRequest):
    """Passive adjacent-pair ratings for the user's own order. Never reorders."""
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    seq = [by_id.get(i, {}) for i in req.ids]
    return {"ratings": [dj.rate_transition(a, b) for a, b in zip(seq, seq[1:])]}


@app.post("/api/dj/energy")
def dj_energy(req: DJIdsRequest):
    """Integrated loudness for the given tracks (cached; computed on demand).

    `energy` keeps its existing shape ({id: float|None}); the sibling `state`
    map ({id: "measured"|"missing"|"failed"}) explains a null so the UI can say
    why a value is absent instead of showing a blank panel."""
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    energy, state = {}, {}
    for i in req.ids:
        t = by_id.get(i)
        result = dj.measure_energy(t["file_path"]) if t else {
            "lufs": None, "state": "missing"}
        energy[i] = result["lufs"]
        state[i] = result["state"]
    return {"energy": energy, "state": state}


@app.post("/api/dj/export")
def dj_export(req: DJExportRequest):
    """Save the ordered set as a NEW rekordbox playlist (never overwrites)."""
    name = req.name.strip()
    if not name or not req.ids:
        raise HTTPException(400, "need a set name and at least one track")
    try:
        return rekordbox.export_playlist(name, req.ids)
    except rekordbox.RekordboxRunning:
        raise HTTPException(409, "close rekordbox first")
    except ValueError as e:
        raise HTTPException(400, str(e))


def _resolve_ids_or_400(ids):
    """Ordered track records for `ids`, resolved against the rekordbox
    collection. Read-only: no backup, no db write, no rekordbox-running gate.
    Any unknown id is a 400 (the whole set would otherwise silently drop it)."""
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    unknown = [i for i in ids if i not in by_id]
    if unknown:
        raise HTTPException(400, f"unknown track ids: {', '.join(unknown)}")
    return [by_id[i] for i in ids]


@app.post("/api/dj/export/m3u8")
def dj_export_m3u8(req: DJExportRequest):
    """Write the ordered set as an m3u8 + JSON sidecar under sets/. Zero write
    risk: never touches master.db, so — unlike /api/dj/export — it takes no
    rekordbox-running guard and works while rekordbox is open."""
    name = req.name.strip()
    if not name or not req.ids:
        raise HTTPException(400, "need a set name and at least one track")
    tracks = _resolve_ids_or_400(req.ids)
    path = setfile.save(SETS_DIR, name, tracks)
    return {"path": str(path), "name": path.stem}


@app.post("/api/dj/export/xml")
def dj_export_xml(req: DJExportRequest):
    """Return a rekordbox-importable DJ_PLAYLISTS XML for the ordered set as the
    response body (so the browser saves it as a .xml). Read-only w.r.t.
    rekordbox — no master.db write, no rekordbox-running guard."""
    name = req.name.strip()
    if not name or not req.ids:
        raise HTTPException(400, "need a set name and at least one track")
    tracks = _resolve_ids_or_400(req.ids)
    xml = setfile.to_rekordbox_xml(tracks, name)
    return Response(
        content=xml, media_type="application/xml",
        headers={"Content-Disposition":
                 f'attachment; filename="{setfile._safe_name(name)}.xml"'})


# ---- audition (stream a collection track's audio; THE security surface) ----
#
# The {track_id} is resolved against the rekordbox collection and the file we
# stream is ALWAYS the collection's stored file_path for that id. The client
# value is only ever a dict key — never joined to a directory, decoded into a
# path, or opened. So no path a client sends can reach open(): an unknown id is
# a 404, and a resolved value that is not a real, present, absolute file
# (spotify: URIs, missing files, unmounted volumes) is a 404. There is no query
# param, fallback, or "convenience" path input anywhere in this handler.

AUDIO_CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
}
_AUDIO_CHUNK = 64 * 1024


def _audio_content_type(path):
    return AUDIO_CONTENT_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")


def _parse_range(header, file_size):
    """Parse a single-range `Range` header against `file_size`.

    Returns an inclusive (start, end), the string "unsatisfiable" (→ 416), or
    None to ignore the header and serve the whole file. Handles suffix
    (`bytes=-500`) and open-ended (`bytes=500-`) ranges. Malformed input is
    ignored rather than raising."""
    if not header:
        return None
    header = header.strip()
    if not header.startswith("bytes=") or "," in header:  # multi-range: serve whole
        return None
    spec = header[len("bytes="):].strip()
    if "-" not in spec:
        return None
    a, _, b = spec.partition("-")
    a, b = a.strip(), b.strip()
    try:
        if a == "":                       # suffix: last N bytes
            length = int(b)
            if length <= 0:
                return "unsatisfiable"
            start, end = max(0, file_size - length), file_size - 1
        else:
            start = int(a)
            end = int(b) if b else file_size - 1
            end = min(end, file_size - 1)
    except ValueError:
        return None
    if start < 0 or start > end or start >= file_size:
        return "unsatisfiable"
    return start, end


def _stream_file(path, start, end):
    """Yield bytes [start, end] inclusive, seeking so playback need not buffer
    from 0. Bounded reads so a large file never lands wholly in memory."""
    with open(path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(_AUDIO_CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@app.get("/api/dj/audio/{track_id}")
def dj_audio(track_id: str, request: Request):
    """Stream a collection track's audio by rekordbox content id, with HTTP range
    support so the browser can seek. See the module comment above for the
    security invariant: the id is a lookup key, never a path."""
    by_id = {t["id"]: t for t in _dj_tracks_or_503()}
    track = by_id.get(track_id)
    if track is None:
        raise HTTPException(404, "unknown track")
    path = track["file_path"]
    # Only a real, present, absolute file is ever opened. isfile() is the guard
    # that also rejects a directory (file_state accepts one via os.path.exists).
    if rekordbox.file_state(path) != "present" or not os.path.isfile(path):
        raise HTTPException(404, "audio file not available")
    file_size = os.path.getsize(path)
    # nosniff: this endpoint streams bytes off the user's disk, so never let a
    # browser second-guess the content type we derived from the extension.
    headers = {"Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff"}
    rng = _parse_range(request.headers.get("range"), file_size)
    if rng == "unsatisfiable":
        return Response(status_code=416,
                        headers={**headers, "Content-Range": f"bytes */{file_size}"})
    if rng is None:
        start, end, status = 0, file_size - 1, 200
    else:
        (start, end), status = rng, 206
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(max(0, end - start + 1))
    return StreamingResponse(
        _stream_file(path, start, end), status_code=status,
        media_type=_audio_content_type(path), headers=headers)


def auto_import(output, files=None):
    """Best-effort import of a finished download. Skips quietly when rekordbox is
    open (the status banner surfaces the pending count instead).

    `files` scopes the import to the paths a job actually produced; when None
    (manual callers), the whole `output` folder is scanned instead."""
    if rekordbox.is_rekordbox_running():
        return
    if files is None:
        p = Path(output)
        if not p.is_dir():
            return
        files = sorted(str(f) for f in p.rglob("*.mp3"))
    if not files:
        return
    rekordbox.import_files(files)


DIST_DIR = STATIC_DIR / "dist"


@app.get("/favicon.svg")
def favicon():
    f = DIST_DIR / "favicon.svg"
    if not f.is_file():
        raise HTTPException(404, "no favicon")
    return FileResponse(f)


@app.get("/assets/{path:path}")
def dist_assets(path: str):
    f = (DIST_DIR / "assets" / path).resolve()
    assets_root = (DIST_DIR / "assets").resolve()
    if not f.is_relative_to(assets_root) or not f.is_file():
        raise HTTPException(404, "no such asset")
    return FileResponse(f)


@app.get("/")
def index():
    dist_index = DIST_DIR / "index.html"
    if not dist_index.is_file():
        raise HTTPException(500, "frontend not built — run: cd frontend && bun install && bun run build")
    return FileResponse(dist_index)


def main():
    # The launcher app opens the browser itself; set SPOTIFY_DL_NO_BROWSER=1
    # to suppress this so we don't end up with two tabs.
    if not os.environ.get("SPOTIFY_DL_NO_BROWSER"):
        threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
