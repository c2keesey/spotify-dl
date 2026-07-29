"""Minimal terminal reviewer for the resolver evaluation set."""

from __future__ import annotations

import curses
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from spotify_dl.resolver_eval import (
    evaluate_eval_set,
    label_for_resolver_result,
    load_eval_set,
    save_eval_set,
    set_gold_label,
)


class AudioPlayer:
    """Play bounded YouTube Music excerpts without blocking the TUI."""

    def __init__(self, *, start_seconds: int = 30, clip_seconds: int = 20):
        self.start_seconds = start_seconds
        self.clip_seconds = clip_seconds
        self.yt_dlp = shutil.which("yt-dlp")
        self.ffplay = shutil.which("ffplay")
        self.mpv = shutil.which("mpv")
        self._lock = threading.Lock()
        self._generation = 0
        self._resolver: subprocess.Popen[str] | None = None
        self._player: subprocess.Popen[Any] | None = None
        self._status = (
            "stopped"
            if self.mpv or (self.yt_dlp and self.ffplay)
            else "audio unavailable: install mpv, or yt-dlp plus ffplay"
        )

    @property
    def available(self) -> bool:
        return bool(self.mpv or (self.yt_dlp and self.ffplay))

    @property
    def status(self) -> str:
        with self._lock:
            return self._status

    def play(self, video_id: str) -> None:
        self.stop()
        if not self.available:
            return
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._status = f"loading {video_id}..."
        threading.Thread(
            target=self._play,
            args=(generation, video_id),
            daemon=True,
        ).start()

    def stop(self) -> None:
        with self._lock:
            self._generation += 1
            resolver = self._resolver
            player = self._player
            self._resolver = None
            self._player = None
            if self.available:
                self._status = "stopped"
        for process in (resolver, player):
            if process and process.poll() is None:
                process.terminate()

    def _play(self, generation: int, video_id: str) -> None:
        url = f"https://music.youtube.com/watch?v={video_id}"
        try:
            if self.mpv:
                command = [
                    self.mpv,
                    "--no-video",
                    "--really-quiet",
                    f"--start={self.start_seconds}",
                    f"--length={self.clip_seconds}",
                    url,
                ]
            else:
                direct_url = self._resolve_url(generation, url)
                if direct_url is None:
                    return
                command = [
                    self.ffplay,
                    "-nodisp",
                    "-autoexit",
                    "-loglevel",
                    "quiet",
                    "-ss",
                    str(self.start_seconds),
                    "-t",
                    str(self.clip_seconds),
                    direct_url,
                ]

            player = subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            with self._lock:
                if generation != self._generation:
                    player.terminate()
                    return
                self._player = player
                self._status = f"playing {video_id}"
            player.wait()
            with self._lock:
                if generation == self._generation:
                    self._player = None
                    self._status = "finished"
        except Exception as error:
            with self._lock:
                if generation == self._generation:
                    self._status = f"audio error: {type(error).__name__}: {error}"

    def _resolve_url(self, generation: int, url: str) -> str | None:
        resolver = subprocess.Popen(
            [
                self.yt_dlp,
                "--no-playlist",
                "--quiet",
                "-f",
                "bestaudio",
                "-g",
                url,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        with self._lock:
            if generation != self._generation:
                resolver.terminate()
                return None
            self._resolver = resolver
        try:
            stdout, stderr = resolver.communicate(timeout=30)
        except subprocess.TimeoutExpired as error:
            resolver.kill()
            resolver.communicate()
            raise RuntimeError("yt-dlp audio lookup timed out") from error
        with self._lock:
            if generation != self._generation:
                return None
            self._resolver = None
        if resolver.returncode:
            raise RuntimeError(stderr.strip() or "yt-dlp could not resolve audio")
        urls = [line for line in stdout.splitlines() if line]
        if not urls:
            raise RuntimeError("yt-dlp returned no audio URL")
        return urls[0]


class ResolverReviewTUI:
    def __init__(
        self,
        path: Path,
        *,
        autoplay: bool = True,
        start_seconds: int = 30,
        clip_seconds: int = 20,
    ):
        self.path = path
        self.eval_set = load_eval_set(path)
        self.report = evaluate_eval_set(self.eval_set)
        self.player = AudioPlayer(
            start_seconds=start_seconds,
            clip_seconds=clip_seconds,
        )
        self.autoplay = autoplay
        self.case_index = self._first_unreviewed()
        self.candidate_index = 0
        self.checked: dict[str, set[str]] = {
            case["case_id"]: set(case["label"]["expected_video_ids"])
            for case in self.eval_set["cases"]
        }
        self.message = ""

    def run(self, screen: Any) -> None:
        curses.curs_set(0)
        screen.keypad(True)
        screen.timeout(100)
        self._enter_case(play=self.autoplay)
        try:
            while True:
                self._draw(screen)
                key = screen.getch()
                if key == -1:
                    continue
                if key in (ord("q"), 27):
                    return
                if key in (curses.KEY_DOWN, ord("j")):
                    self._move_candidate(1)
                elif key in (curses.KEY_UP, ord("k")):
                    self._move_candidate(-1)
                elif key in (curses.KEY_RIGHT, ord("l")):
                    self._move_case(1)
                elif key in (curses.KEY_LEFT, ord("h")):
                    self._move_case(-1)
                elif key in (10, 13, ord("p")):
                    self._play_selected()
                elif key == ord(" "):
                    self.player.stop()
                elif key == ord("x"):
                    self._toggle_selected()
                elif key == ord("y"):
                    status, video_ids = label_for_resolver_result(self._result)
                    self._save_classification(status, video_ids)
                elif key == ord("v"):
                    video_ids = self._checked_video_ids()
                    if not video_ids:
                        video_ids = [self._selected_video_id]
                    self._save_classification("verified", video_ids)
                elif key == ord("r"):
                    self._save_classification("rejected", [])
                elif key == ord("a"):
                    self._save_classification(
                        "ambiguous",
                        self._checked_video_ids(),
                    )
                elif key == ord("u"):
                    self._defer()
                elif key == ord("f"):
                    self._jump_to_state("needs_review")
                elif key == ord("n"):
                    self._jump_to_unreviewed()
        finally:
            self.player.stop()

    @property
    def _result(self) -> dict[str, Any]:
        return self.report["cases"][self.case_index]

    @property
    def _case(self) -> dict[str, Any]:
        return self.eval_set["cases"][self.case_index]

    @property
    def _candidates(self) -> list[dict[str, Any]]:
        return self._result["candidates"]

    @property
    def _selected_video_id(self) -> str:
        return self._candidates[self.candidate_index]["source"]["video_id"]

    @property
    def _checked_ids(self) -> set[str]:
        return self.checked[self._case["case_id"]]

    def _first_unreviewed(self) -> int:
        for index, result in enumerate(self.report["cases"]):
            if result["label"]["state"] != "gold":
                return index
        return 0

    def _enter_case(self, *, play: bool) -> None:
        candidates = self._candidates
        expected_ids = self._case["label"]["expected_video_ids"]
        self.candidate_index = next(
            (
                index
                for index, candidate in enumerate(candidates)
                if candidate["source"]["video_id"] in expected_ids
            ),
            0,
        )
        if play:
            self._play_selected()

    def _move_candidate(self, offset: int) -> None:
        new_index = min(
            max(0, self.candidate_index + offset),
            len(self._candidates) - 1,
        )
        if new_index != self.candidate_index:
            self.candidate_index = new_index
            self._play_selected()

    def _move_case(self, offset: int) -> None:
        self.case_index = (self.case_index + offset) % len(self.report["cases"])
        self.message = ""
        self._enter_case(play=self.autoplay)

    def _play_selected(self) -> None:
        self.player.play(self._selected_video_id)

    def _toggle_selected(self) -> None:
        video_id = self._selected_video_id
        if video_id in self._checked_ids:
            self._checked_ids.remove(video_id)
        else:
            self._checked_ids.add(video_id)
        self.message = f"{len(self._checked_ids)} acceptable candidate(s) selected"

    def _checked_video_ids(self) -> list[str]:
        return [
            candidate["source"]["video_id"]
            for candidate in self._candidates
            if candidate["source"]["video_id"] in self._checked_ids
        ]

    def _save_classification(self, status: str, video_ids: list[str]) -> None:
        try:
            set_gold_label(self._case, status, video_ids)
            save_eval_set(self.path, self.eval_set)
        except ValueError as error:
            self.message = str(error)
            return
        self.report = evaluate_eval_set(self.eval_set)
        self.checked[self._case["case_id"]] = set(video_ids)
        self.message = f"saved gold label: {status}"
        self._advance_after_save()

    def _advance_after_save(self) -> None:
        start = self.case_index
        for distance in range(1, len(self.report["cases"]) + 1):
            index = (start + distance) % len(self.report["cases"])
            if self.report["cases"][index]["label"]["state"] != "gold":
                self.case_index = index
                self._enter_case(play=self.autoplay)
                return
        self.player.stop()
        self.message = "all cases have gold labels"

    def _defer(self) -> None:
        self._case["label"]["state"] = "needs_review"
        save_eval_set(self.path, self.eval_set)
        self.report = evaluate_eval_set(self.eval_set)
        self._move_case(1)
        self.message = "left as needs_review"

    def _jump_to_state(self, state: str) -> None:
        for distance in range(1, len(self.report["cases"]) + 1):
            index = (self.case_index + distance) % len(self.report["cases"])
            if self.report["cases"][index]["label"]["state"] == state:
                self.case_index = index
                self._enter_case(play=self.autoplay)
                return
        self.message = f"no {state} cases"

    def _jump_to_unreviewed(self) -> None:
        for distance in range(1, len(self.report["cases"]) + 1):
            index = (self.case_index + distance) % len(self.report["cases"])
            if self.report["cases"][index]["label"]["state"] != "gold":
                self.case_index = index
                self._enter_case(play=self.autoplay)
                return
        self.message = "all cases have gold labels"

    def _draw(self, screen: Any) -> None:
        screen.erase()
        height, width = screen.getmaxyx()
        result = self._result
        spotify = result["spotify"]
        label = result["label"]
        actual = result["actual"]
        expected_ids = ", ".join(label["expected_video_ids"]) or "none"
        lines = [
            "Resolver eval review",
            (
                f"Case {self.case_index + 1}/{len(self.report['cases'])}: "
                f"{result['case_id']} [{label['state']}]"
            ),
            f"{', '.join(spotify['artists'])} — {spotify['title']}",
            (
                f"Expected: {label['expected_status']} ({expected_ids}) | "
                f"Resolver: {actual['status']} ({actual['video_id'] or 'none'})"
            ),
            f"Audio: {self.player.status}",
            "",
            "Candidates (move selection to autoplay; x toggles acceptable):",
        ]
        for row, line in enumerate(lines):
            self._add(screen, row, line, width)

        candidate_start = len(lines)
        footer_height = 4
        visible_count = max(1, height - candidate_start - footer_height)
        viewport_start = min(
            max(0, self.candidate_index - visible_count + 1),
            max(0, len(self._candidates) - visible_count),
        )
        for visible_index, candidate in enumerate(
            self._candidates[viewport_start : viewport_start + visible_count]
        ):
            index = viewport_start + visible_index
            source = candidate["source"]
            duration = _format_duration(source["duration_ms"])
            checked = "x" if source["video_id"] in self._checked_ids else " "
            failed = ",".join(candidate["rejection_reasons"]) or "none"
            line = (
                f"[{checked}] {index + 1:>2}. {', '.join(source['artists'])} — "
                f"{source['title']} [{duration}] score "
                f"{candidate['scores']['overall']:.3f} fail:{failed}"
            )
            attribute = curses.A_REVERSE if index == self.candidate_index else 0
            self._add(screen, candidate_start + visible_index, line, width, attribute)

        footer = max(candidate_start + visible_count, height - footer_height)
        self._add(
            screen,
            footer,
            "↑↓/jk candidate  ←→/hl case  Enter/p play  Space stop  x acceptable",
            width,
        )
        self._add(
            screen,
            footer + 1,
            "y resolver is right  v selected song is right  r no song is right",
            width,
        )
        self._add(
            screen,
            footer + 2,
            "a checked songs ambiguous  u defer  n unreviewed  f fence  q quit",
            width,
        )
        self._add(screen, footer + 3, self.message, width, curses.A_BOLD)
        screen.refresh()

    @staticmethod
    def _add(
        screen: Any,
        row: int,
        text: str,
        width: int,
        attribute: int = 0,
    ) -> None:
        try:
            screen.addnstr(row, 0, text, max(0, width - 1), attribute)
        except curses.error:
            pass


def _format_duration(duration_ms: int | None) -> str:
    if duration_ms is None:
        return "?:??"
    seconds = round(duration_ms / 1000)
    return f"{seconds // 60}:{seconds % 60:02d}"


def review_eval_set(
    path: Path,
    *,
    autoplay: bool = True,
    start_seconds: int = 30,
    clip_seconds: int = 20,
) -> None:
    reviewer = ResolverReviewTUI(
        path,
        autoplay=autoplay,
        start_seconds=start_seconds,
        clip_seconds=clip_seconds,
    )
    curses.wrapper(reviewer.run)
