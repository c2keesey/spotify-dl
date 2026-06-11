"""Minimal localhost web UI: paste links to download, view crons.

Run with `uv run spotify-dl-ui`. Downloads run the CLI as a subprocess so the
web layer stays a thin shell over the exact same code path as the terminal.
"""

import itertools
import re
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"
DEFAULT_OUTPUT = REPO_ROOT / "downloads"
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
TRACK_FAIL_RE = re.compile(r"^Failed to download ")
PCT_RE = re.compile(r"\[download\]\s+([\d.]+)% of")

jobs = {}
job_ids = itertools.count(1)
jobs_lock = threading.Lock()


class DownloadRequest(BaseModel):
    urls: list[str]
    output: str = ""


def run_job(job):
    env = {**dict(dotenv_values(REPO_ROOT / ".env")), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HOME": str(Path.home())}
    cmd = [
        sys.executable, "-m", "spotify_dl.spotify_dl",
        "-l", *job["urls"],
        "-o", job["output"],
        "-mc", "4",
        "-w",
    ]
    try:
        proc = subprocess.Popen(
            cmd, cwd=REPO_ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        for line in proc.stdout:
            job["log"].append(ANSI_RE.sub("", line.rstrip("\n")))
        proc.wait()
        job["status"] = "done" if proc.returncode == 0 else "failed"
    except Exception as e:  # noqa: BLE001 - surface anything to the UI
        job["log"].append(f"error: {e}")
        job["status"] = "failed"


@app.post("/api/download")
def start_download(req: DownloadRequest):
    urls = [u.strip() for u in req.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "no urls")
    output = req.output.strip() or str(DEFAULT_OUTPUT)
    Path(output).expanduser().mkdir(parents=True, exist_ok=True)
    job = {
        "id": next(job_ids),
        "urls": urls,
        "output": output,
        "status": "running",
        "log": [],
    }
    with jobs_lock:
        jobs[job["id"]] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return {"id": job["id"]}


def parse_progress(log):
    """Derive structured progress from the CLI's log lines. With -mc the
    workers' output interleaves, so counts are exact but `current` is just
    the most recently started track."""
    total = done = failed = 0
    current = ""
    pct = 0.0
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
        elif TRACK_FAIL_RE.match(line):
            failed += 1
        elif m := PCT_RE.search(line):
            pct = float(m.group(1))
    return {"total": total, "done": done, "failed": failed, "current": current, "pct": pct}


@app.get("/api/jobs")
def list_jobs():
    return [
        {
            "id": j["id"],
            "urls": j["urls"],
            "output": j["output"],
            "status": j["status"],
            "lines": len(j["log"]),
            "progress": parse_progress(j["log"]),
        }
        for j in sorted(jobs.values(), key=lambda j: -j["id"])
    ]


@app.get("/api/jobs/{job_id}/log")
def job_log(job_id: int, offset: int = 0):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    return {"status": job["status"], "lines": job["log"][offset:], "offset": len(job["log"])}


@app.get("/api/crons")
def list_crons():
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    entries = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        enabled = not line.startswith("#")
        if not enabled:
            # only surface commented lines that are disabled cron entries
            body = line.lstrip("# ").removeprefix("DISABLED:").strip()
            if not re.match(r"^[\d*@]", body):
                continue
            line = body
        parts = line.split(None, 5)
        if len(parts) < 6:
            continue
        schedule, command = " ".join(parts[:5]), parts[5]
        if "spotify-dl" not in command:
            continue
        entries.append({
            "schedule": schedule,
            "command": command,
            "enabled": enabled,
        })
    return entries


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


def main():
    threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
