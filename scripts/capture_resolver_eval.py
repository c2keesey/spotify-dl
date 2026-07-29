"""Refresh YouTube Music candidate snapshots in a resolver eval set."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from ytmusicapi import YTMusic

from spotify_dl.resolver import MAX_CANDIDATES, RESOLVER_VERSION, utc_now
from spotify_dl.resolver_eval import load_eval_set, validate_eval_set


DEFAULT_PATH = Path("evals/resolver/v1.json")
CAPTURE_FIELDS = (
    "resultType",
    "title",
    "album",
    "videoId",
    "duration",
    "duration_seconds",
    "artists",
    "isAvailable",
)


def compact_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    """Keep only stable metadata used by the resolver or human review."""
    return {
        key: candidate[key]
        for key in CAPTURE_FIELDS
        if key in candidate and candidate[key] is not None
    }


def capture(path: Path) -> dict[str, Any]:
    eval_set = load_eval_set(path, require_candidates=False)
    client = YTMusic()
    captured_cases = []

    for case in eval_set["cases"]:
        spotify = case["spotify"]
        artist_names = [artist["name"] for artist in spotify["artists"]]
        query = f"{', '.join(artist_names)} - {spotify['name']}"
        search_filter = "songs"
        candidates = client.search(query, filter=search_filter)
        if not candidates:
            search_filter = "videos"
            candidates = client.search(query, filter=search_filter)

        seen_video_ids: set[str] = set()
        compact_candidates = []
        for candidate in candidates or []:
            video_id = candidate.get("videoId")
            if not video_id or video_id in seen_video_ids:
                continue
            seen_video_ids.add(video_id)
            compact_candidates.append(compact_candidate(candidate))
            if len(compact_candidates) >= MAX_CANDIDATES:
                break
        if not compact_candidates:
            raise RuntimeError(f"No candidates captured for {case['case_id']}")

        captured_cases.append(
            {
                **case,
                "query": query,
                "search_filter": search_filter,
                "candidates": compact_candidates,
            }
        )

    captured = {
        **eval_set,
        "captured_at": utc_now(),
        "resolver_version_at_capture": RESOLVER_VERSION,
        "cases": captured_cases,
    }
    validate_eval_set(captured)
    return captured


def atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.replace(temporary_path, path)
    except Exception:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args()
    captured = capture(args.path)
    atomic_write(args.path, captured)
    print(f"Captured {len(captured['cases'])} cases in {args.path}")


if __name__ == "__main__":
    main()
