"""Interactively listen to and classify resolver evaluation cases."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from spotify_dl.resolver_tui import review_eval_set


DEFAULT_PATH = Path("evals/resolver/v1.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--no-autoplay", action="store_true")
    parser.add_argument("--start-seconds", type=int, default=30)
    parser.add_argument("--clip-seconds", type=int, default=20)
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        parser.error("the reviewer must be run in an interactive terminal")
    review_eval_set(
        args.path,
        autoplay=not args.no_autoplay,
        start_seconds=max(0, args.start_seconds),
        clip_seconds=max(1, args.clip_seconds),
    )


if __name__ == "__main__":
    main()
