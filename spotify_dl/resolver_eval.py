"""Deterministic evaluation helpers for captured resolver search results."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from spotify_dl.resolver import evaluate_candidates


SCHEMA_VERSION = 1
LABEL_STATES = frozenset({"gold", "provisional", "needs_review"})
EXPECTED_STATUSES = frozenset({"verified", "rejected", "ambiguous"})


def load_eval_set(
    path: str | Path, *, require_candidates: bool = True
) -> dict[str, Any]:
    """Load and validate a resolver evaluation set."""
    with Path(path).open(encoding="utf-8") as file:
        eval_set = json.load(file)
    validate_eval_set(eval_set, require_candidates=require_candidates)
    return eval_set


def validate_eval_set(
    eval_set: dict[str, Any], *, require_candidates: bool = True
) -> None:
    """Validate the small, intentionally explicit eval-set schema."""
    if eval_set.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
    if not isinstance(eval_set.get("cases"), list) or not eval_set["cases"]:
        raise ValueError("cases must be a non-empty list")

    seen_case_ids: set[str] = set()
    for index, case in enumerate(eval_set["cases"]):
        location = f"cases[{index}]"
        case_id = _required_string(case, "case_id", location)
        if case_id in seen_case_ids:
            raise ValueError(f"duplicate case_id: {case_id}")
        seen_case_ids.add(case_id)

        spotify = case.get("spotify")
        if not isinstance(spotify, dict):
            raise ValueError(f"{location}.spotify must be an object")
        _required_string(spotify, "spotify_id", f"{location}.spotify")
        _required_string(spotify, "name", f"{location}.spotify")
        artists = spotify.get("artists")
        if not isinstance(artists, list) or not artists:
            raise ValueError(f"{location}.spotify.artists must be a non-empty list")
        for artist_index, artist in enumerate(artists):
            if not isinstance(artist, dict):
                raise ValueError(
                    f"{location}.spotify.artists[{artist_index}] must be an object"
                )
            _required_string(
                artist,
                "name",
                f"{location}.spotify.artists[{artist_index}]",
            )
        duration_ms = spotify.get("duration_ms")
        if not isinstance(duration_ms, int) or duration_ms <= 0:
            raise ValueError(f"{location}.spotify.duration_ms must be positive")

        label = case.get("label")
        if not isinstance(label, dict):
            raise ValueError(f"{location}.label must be an object")
        state = label.get("state")
        if state not in LABEL_STATES:
            raise ValueError(
                f"{location}.label.state must be one of {sorted(LABEL_STATES)}"
            )
        expected_status = label.get("expected_status")
        if expected_status not in EXPECTED_STATUSES:
            raise ValueError(
                f"{location}.label.expected_status must be one of "
                f"{sorted(EXPECTED_STATUSES)}"
            )
        expected_video_ids = label.get("expected_video_ids")
        if not isinstance(expected_video_ids, list) or not all(
            isinstance(video_id, str) and video_id for video_id in expected_video_ids
        ):
            raise ValueError(
                f"{location}.label.expected_video_ids must be a list of strings"
            )
        if expected_status in {"verified", "ambiguous"} and not expected_video_ids:
            raise ValueError(
                f"{location}.label.expected_video_ids cannot be empty for "
                f"{expected_status}"
            )
        _required_string(label, "provenance", f"{location}.label")

        candidates = case.get("candidates")
        if not isinstance(candidates, list):
            raise ValueError(f"{location}.candidates must be a list")
        if require_candidates and not candidates:
            raise ValueError(f"{location}.candidates cannot be empty")
        seen_video_ids: set[str] = set()
        for candidate_index, candidate in enumerate(candidates):
            candidate_location = f"{location}.candidates[{candidate_index}]"
            if not isinstance(candidate, dict):
                raise ValueError(f"{candidate_location} must be an object")
            video_id = _required_string(candidate, "videoId", candidate_location)
            if video_id in seen_video_ids:
                raise ValueError(f"{location} has duplicate videoId: {video_id}")
            seen_video_ids.add(video_id)


def evaluate_eval_set(eval_set: dict[str, Any]) -> dict[str, Any]:
    """Run the resolver offline and score only human-approved gold labels."""
    validate_eval_set(eval_set)
    results = []
    state_counts: Counter[str] = Counter()
    predicted_status_counts: Counter[str] = Counter()
    gold_passed = 0
    gold_failed = 0

    for case in eval_set["cases"]:
        label = case["label"]
        decision = evaluate_candidates(
            case["spotify"],
            case["candidates"],
            resolved_at=eval_set.get("captured_at"),
        )
        actual_video_id = (
            decision["source"]["video_id"] if decision.get("source") else None
        )
        expected_video_ids = label["expected_video_ids"]
        status_matches = decision["status"] == label["expected_status"]
        video_matches = (
            not expected_video_ids or actual_video_id in expected_video_ids
        )
        observed_agreement = status_matches and video_matches
        counted_in_metrics = label["state"] == "gold"

        if counted_in_metrics:
            if observed_agreement:
                gold_passed += 1
            else:
                gold_failed += 1

        state_counts[label["state"]] += 1
        predicted_status_counts[decision["status"]] += 1
        results.append(
            {
                "case_id": case["case_id"],
                "spotify": decision["spotify"],
                "tags": case.get("tags", []),
                "label": label,
                "actual": {
                    "status": decision["status"],
                    "video_id": actual_video_id,
                    "reasons": decision["reasons"],
                    "scores": decision["scores"],
                },
                "observed_agreement": observed_agreement,
                "counted_in_metrics": counted_in_metrics,
                "candidates": decision["candidates"],
            }
        )

    gold_total = gold_passed + gold_failed
    return {
        "dataset": eval_set.get("name"),
        "captured_at": eval_set.get("captured_at"),
        "summary": {
            "total_cases": len(results),
            "label_states": {
                state: state_counts[state]
                for state in ("gold", "provisional", "needs_review")
            },
            "predicted_statuses": {
                status: predicted_status_counts[status]
                for status in ("verified", "rejected", "ambiguous")
            },
            "gold_total": gold_total,
            "gold_passed": gold_passed,
            "gold_failed": gold_failed,
            "gold_accuracy": gold_passed / gold_total if gold_total else None,
        },
        "cases": results,
    }


def _required_string(value: dict[str, Any], key: str, location: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{location}.{key} must be a non-empty string")
    return result
