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


@app.get("/api/jobs")
def list_jobs():
    return [
        {
            "id": j["id"],
            "urls": j["urls"],
            "output": j["output"],
            "status": j["status"],
            "lines": len(j["log"]),
            "last": j["log"][-1] if j["log"] else "",
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
        entries.append({
            "schedule": schedule,
            "command": command,
            "enabled": enabled,
            "mine": "spotify-dl" in command,
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
