"""Resolve Spotify tracks to auditable, pinned YouTube Music sources."""

from __future__ import annotations

import json
import os
import re
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import Levenshtein
import ytmusicapi


RESOLVER_VERSION = "2"
APPROVED_STATUSES = frozenset({"verified", "manual"})
TITLE_SIMILARITY_MIN = 0.92
ARTIST_SIMILARITY_MIN = 0.85
OVERALL_SCORE_MIN = 0.90
RUNNER_UP_MARGIN_MIN = 0.05
MAX_CANDIDATES = 10

# Audio-content matching is deliberately unable to approve a source. Enabling
# it later requires defining thresholds, a cache, resource limits, and tests.
AUDIO_ANALYSIS_POLICY = {
    "status": "disabled",
    "auto_approval": False,
    "reason": "No bounded, cached audio-content verifier is configured.",
}

_VERSION_PATTERNS = {
    "acoustic": re.compile(r"\b(acoustic|unplugged)\b", re.IGNORECASE),
    "demo": re.compile(r"\bdemo\b", re.IGNORECASE),
    "edit": re.compile(r"\b(edit|radio edit)\b", re.IGNORECASE),
    "extended": re.compile(r"\bextended\b", re.IGNORECASE),
    "instrumental": re.compile(r"\binstrumental\b", re.IGNORECASE),
    "live": re.compile(r"\blive\b", re.IGNORECASE),
    "mix": re.compile(r"\bmix\b", re.IGNORECASE),
    "remaster": re.compile(r"\b(remaster(?:ed)?|remastering)\b", re.IGNORECASE),
    "remix": re.compile(r"\b(remix(?:ed)?|rework|bootleg)\b", re.IGNORECASE),
    "slowed": re.compile(r"\b(slowed|slowed down)\b", re.IGNORECASE),
    "sped-up": re.compile(r"\b(sped[\s-]?up|speed up)\b", re.IGNORECASE),
    "version": re.compile(r"\bversion\b", re.IGNORECASE),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_text(value: str | None) -> str:
    """Normalize human metadata for stable comparisons and audit output."""
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(
        character for character in value if not unicodedata.combining(character)
    )
    value = value.casefold().replace("&", " and ")
    value = re.sub(r"\b(feat|ft)\.?\b", " featuring ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def extract_version_markers(value: str | None) -> list[str]:
    """Return normalized mix/version markers present in a title."""
    return sorted(
        marker
        for marker, pattern in _VERSION_PATTERNS.items()
        if pattern.search(value or "")
    )


def _artist_names(value: Any) -> list[str]:
    if isinstance(value, list):
        names = [
            item.get("name") if isinstance(item, dict) else str(item) for item in value
        ]
    else:
        names = re.split(
            r",|;|\b(?:feat(?:uring)?|ft)\.?\b", str(value or ""), flags=re.I
        )
    return [name.strip() for name in names if name and name.strip()]


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return float(Levenshtein.ratio(left, right))


def _artist_similarity(spotify_artists: list[str], source_artists: list[str]) -> float:
    normalized_spotify = [normalize_text(artist) for artist in spotify_artists]
    normalized_source = []
    for artist in source_artists:
        normalized_source.append(normalize_text(artist))
        normalized_source.extend(
            normalize_text(part)
            for part in re.split(r",|;|&|\band\b", artist, flags=re.I)
            if part.strip()
        )
    if not normalized_spotify or not normalized_source:
        return 0.0
    # Require the primary Spotify artist to have a strong source counterpart.
    return max(
        _similarity(normalized_spotify[0], source_artist)
        for source_artist in normalized_source
    )


def _title_without_artist_credits(
    normalized_title: str,
    normalized_spotify_artists: list[str],
) -> str:
    """Strip a suffix only when Spotify metadata explains every credit."""
    for marker in (" featuring ", " with "):
        if marker not in normalized_title:
            continue
        base, credits = normalized_title.split(marker, 1)
        remainder = credits
        matched = False
        for artist in sorted(
            normalized_spotify_artists[1:],
            key=len,
            reverse=True,
        ):
            if artist and artist in remainder:
                remainder = remainder.replace(artist, " ")
                matched = True
        remainder = re.sub(r"\b(and|featuring|with)\b", " ", remainder)
        if matched and not " ".join(remainder.split()):
            return base
    return normalized_title


def _duration_ms(candidate: dict[str, Any]) -> int | None:
    seconds = candidate.get("duration_seconds")
    if seconds is not None:
        try:
            return round(float(seconds) * 1000)
        except (TypeError, ValueError):
            return None

    duration = candidate.get("duration")
    if isinstance(duration, (int, float)):
        return round(float(duration) * 1000)
    if not isinstance(duration, str):
        return None
    try:
        parts = [int(part) for part in duration.split(":")]
    except ValueError:
        return None
    if not parts or len(parts) > 3:
        return None
    seconds_total = 0
    for part in parts:
        seconds_total = seconds_total * 60 + part
    return seconds_total * 1000


def _duration_limit_ms(spotify_duration_ms: int) -> int:
    return min(8000, max(5000, round(spotify_duration_ms * 0.03)))


def _source_metadata(candidate: dict[str, Any]) -> dict[str, Any]:
    album = candidate.get("album")
    if isinstance(album, dict):
        album = album.get("name")
    return {
        "provider": "youtube_music",
        "video_id": candidate.get("videoId") or candidate.get("video_id"),
        "title": candidate.get("title"),
        "artists": _artist_names(candidate.get("artists")),
        "album": album,
        "duration_ms": _duration_ms(candidate),
        "result_type": candidate.get("resultType") or candidate.get("result_type"),
    }


def spotify_metadata(track: dict[str, Any]) -> dict[str, Any]:
    artists = _artist_names(track.get("artists") or track.get("artist"))
    title = track.get("name") or track.get("title")
    album = track.get("album")
    if isinstance(album, dict):
        album = album.get("name")
    version_markers = track.get("version_markers")
    if version_markers is None:
        version_markers = extract_version_markers(title)
    elif isinstance(version_markers, str):
        version_markers = [version_markers]
    return {
        "id": track.get("spotify_id") or track.get("id"),
        "title": title,
        "artists": artists,
        "album": album,
        "duration_ms": track.get("duration_ms"),
        "version_markers": sorted(version_markers),
    }


def _score_candidate(
    spotify: dict[str, Any], candidate: dict[str, Any]
) -> dict[str, Any] | None:
    source = _source_metadata(candidate)
    if not source["video_id"] or not source["title"] or not source["artists"]:
        return None
    if candidate.get("isAvailable") is False:
        return None

    normalized_spotify_title = normalize_text(spotify["title"])
    normalized_source_title = normalize_text(source["title"])
    normalized_spotify_artists = [normalize_text(value) for value in spotify["artists"]]
    normalized_source_artists = [normalize_text(value) for value in source["artists"]]
    spotify_title_for_similarity = _title_without_artist_credits(
        normalized_spotify_title,
        normalized_spotify_artists,
    )
    source_title_for_similarity = _title_without_artist_credits(
        normalized_source_title,
        normalized_spotify_artists,
    )
    title_similarity = _similarity(
        spotify_title_for_similarity,
        source_title_for_similarity,
    )
    artist_similarity = _artist_similarity(spotify["artists"], source["artists"])
    album_similarity = _similarity(
        normalize_text(spotify.get("album")),
        normalize_text(source.get("album")),
    )

    spotify_duration = spotify.get("duration_ms")
    source_duration = source.get("duration_ms")
    duration_delta = (
        abs(int(spotify_duration) - int(source_duration))
        if spotify_duration is not None and source_duration is not None
        else None
    )
    duration_limit = (
        _duration_limit_ms(int(spotify_duration))
        if spotify_duration is not None
        else None
    )
    duration_similarity = (
        max(0.0, 1.0 - duration_delta / (duration_limit * 4))
        if duration_delta is not None and duration_limit
        else 0.0
    )

    source_markers = extract_version_markers(source["title"])
    version_match = spotify["version_markers"] == source_markers
    gates = {
        "title": title_similarity >= TITLE_SIMILARITY_MIN,
        "artist": artist_similarity >= ARTIST_SIMILARITY_MIN,
        "duration": (
            duration_delta is not None
            and duration_limit is not None
            and duration_delta <= duration_limit
        ),
        "version": version_match,
    }
    reasons = [name for name, passed in gates.items() if not passed]
    overall = (
        0.55 * title_similarity + 0.35 * artist_similarity + 0.10 * duration_similarity
    )
    eligible = all(gates.values()) and overall >= OVERALL_SCORE_MIN

    return {
        "source": source,
        "normalized": {
            "spotify_title": normalized_spotify_title,
            "source_title": normalized_source_title,
            "spotify_title_for_similarity": spotify_title_for_similarity,
            "source_title_for_similarity": source_title_for_similarity,
            "spotify_artists": normalized_spotify_artists,
            "source_artists": normalized_source_artists,
        },
        "scores": {
            "title_similarity": round(title_similarity, 6),
            "artist_similarity": round(artist_similarity, 6),
            "album_similarity": round(album_similarity, 6),
            "duration_similarity": round(duration_similarity, 6),
            "duration_delta_ms": duration_delta,
            "duration_limit_ms": duration_limit,
            "overall": round(overall, 6),
        },
        "version_markers": {
            "spotify": spotify["version_markers"],
            "source": source_markers,
        },
        "gates": gates,
        "eligible": eligible,
        "rejection_reasons": reasons,
    }


def _equivalent_sources(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Return whether either eligible source is safe for the same recording."""
    left_duration = left["source"].get("duration_ms")
    right_duration = right["source"].get("duration_ms")
    return bool(
        left_duration is not None
        and right_duration is not None
        and abs(int(left_duration) - int(right_duration)) <= 2000
        and left["normalized"]["source_title_for_similarity"]
        == right["normalized"]["source_title_for_similarity"]
        and left["version_markers"]["source"]
        == right["version_markers"]["source"]
    )


def evaluate_candidates(
    track: dict[str, Any],
    candidates: Iterable[dict[str, Any]],
    *,
    resolved_at: str | None = None,
) -> dict[str, Any]:
    """Evaluate candidates without network access."""
    spotify = spotify_metadata(track)
    scored = [
        result
        for candidate in candidates
        if (result := _score_candidate(spotify, candidate)) is not None
    ]
    scored.sort(
        key=lambda item: (
            item["scores"]["overall"],
            item["scores"]["album_similarity"],
            item["source"]["video_id"],
        ),
        reverse=True,
    )

    eligible = [candidate for candidate in scored if candidate["eligible"]]
    has_close_runner = bool(
        len(eligible) > 1
        and eligible[0]["scores"]["overall"]
        - eligible[1]["scores"]["overall"]
        < RUNNER_UP_MARGIN_MIN
    )
    equivalent_tie = bool(
        has_close_runner and _equivalent_sources(eligible[0], eligible[1])
    )
    exact_album_preference = bool(
        has_close_runner
        and eligible[0]["scores"]["album_similarity"] == 1
        and eligible[1]["scores"]["album_similarity"] < 1
    )

    if not scored:
        status = "rejected"
        reasons = ["no_valid_candidates"]
        selected = None
        comparison_pool = []
    elif not eligible:
        status = "rejected"
        reasons = ["strict_gates_failed"]
        selected = scored[0]
        comparison_pool = scored
    elif has_close_runner and not equivalent_tie and not exact_album_preference:
        status = "ambiguous"
        reasons = ["runner_up_margin_too_small"]
        selected = eligible[0]
        comparison_pool = eligible
    else:
        status = "verified"
        reasons = (
            ["exact_album_preferred"]
            if exact_album_preference
            else ["equivalent_candidates"]
            if equivalent_tie
            else []
        )
        selected = eligible[0]
        comparison_pool = eligible

    runner_up = comparison_pool[1] if len(comparison_pool) > 1 else None
    runner_up_margin = (
        round(
            selected["scores"]["overall"] - runner_up["scores"]["overall"],
            6,
        )
        if selected and runner_up
        else None
    )

    selected_scores = dict(selected["scores"]) if selected else None
    if selected_scores is not None:
        selected_scores["runner_up_margin"] = runner_up_margin

    return {
        "spotify_id": spotify["id"],
        "status": status,
        "resolution_method": "metadata",
        "resolver_version": RESOLVER_VERSION,
        "resolved_at": resolved_at or utc_now(),
        "spotify": spotify,
        "source": selected["source"] if selected else None,
        "normalized": selected["normalized"] if selected else None,
        "scores": selected_scores,
        "runner_up": runner_up,
        "candidates": scored,
        "reasons": reasons,
        "audio_analysis": dict(AUDIO_ANALYSIS_POLICY),
    }


def is_approved_decision(decision: dict[str, Any] | None) -> bool:
    return bool(decision and decision.get("status") in APPROVED_STATUSES)


class MatchStore:
    """Atomic JSON store for decisions and durable manual overrides."""

    def __init__(self, path: str | os.PathLike[str]):
        self.path = Path(path)
        self.data = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"version": 1, "overrides": {}, "decisions": {}}
        with self.path.open(encoding="utf-8") as file:
            data = json.load(file)
        data.setdefault("version", 1)
        data.setdefault("overrides", {})
        data.setdefault("decisions", {})
        return data

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor, temporary_path = tempfile.mkstemp(
            dir=self.path.parent, suffix=".tmp"
        )
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as file:
                json.dump(self.data, file, indent=2, sort_keys=True)
            os.replace(temporary_path, self.path)
        except Exception:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
            raise

    def approve(self, spotify_id: str, video_id: str) -> None:
        self.data["overrides"][spotify_id] = {
            "status": "manual",
            "video_id": video_id,
            "updated_at": utc_now(),
        }
        self.data["decisions"].pop(spotify_id, None)
        self._save()

    def reject(self, spotify_id: str) -> None:
        self.data["overrides"][spotify_id] = {
            "status": "rejected",
            "video_id": None,
            "updated_at": utc_now(),
        }
        self.data["decisions"].pop(spotify_id, None)
        self._save()

    def manual_decision_for(self, track: dict[str, Any]) -> dict[str, Any] | None:
        spotify = spotify_metadata(track)
        spotify_id = spotify["id"]
        override = self.data["overrides"].get(spotify_id)
        if override:
            status = override["status"]
            return {
                "spotify_id": spotify_id,
                "status": status,
                "resolution_method": "manual_override",
                "resolver_version": RESOLVER_VERSION,
                "resolved_at": override["updated_at"],
                "spotify": spotify,
                "source": (
                    {
                        "provider": "youtube_music",
                        "video_id": override["video_id"],
                        "title": None,
                        "artists": [],
                        "album": None,
                        "duration_ms": None,
                        "result_type": None,
                    }
                    if override["video_id"]
                    else None
                ),
                "normalized": None,
                "scores": None,
                "runner_up": None,
                "candidates": [],
                "reasons": [
                    "manual_approval" if status == "manual" else "manual_rejection"
                ],
                "audio_analysis": dict(AUDIO_ANALYSIS_POLICY),
            }
        return None

    def decision_for(self, track: dict[str, Any]) -> dict[str, Any] | None:
        manual = self.manual_decision_for(track)
        if manual is not None:
            return manual

        spotify_id = spotify_metadata(track)["id"]
        decision = self.data["decisions"].get(spotify_id)
        if (
            is_approved_decision(decision)
            and decision.get("resolver_version") == RESOLVER_VERSION
        ):
            return decision
        return None

    def save_decision(self, decision: dict[str, Any]) -> None:
        self.save_decisions([decision])

    def save_decisions(self, decisions: Iterable[dict[str, Any]]) -> None:
        """Persist multiple resolver decisions with one atomic store write."""
        changed = False
        for decision in decisions:
            spotify_id = decision.get("spotify_id")
            if spotify_id:
                self.data["decisions"][spotify_id] = decision
                changed = True
        if changed:
            self._save()


class TrackResolver:
    """Search YouTube Music, evaluate candidates, and persist the decision."""

    def __init__(
        self,
        store: MatchStore,
        client_factory: Callable[[], Any] = ytmusicapi.YTMusic,
        max_candidates: int = MAX_CANDIDATES,
    ):
        self.store = store
        self.client_factory = client_factory
        self.max_candidates = max_candidates

    def _search_requests(
        self,
        requests: list[tuple[str, str]],
        *,
        existing: Iterable[dict[str, Any]] = (),
    ) -> list[dict[str, Any]]:
        deduplicated = {
            candidate.get("videoId"): candidate
            for candidate in existing
            if candidate.get("videoId")
        }
        if not requests:
            return list(deduplicated.values())

        def collect(ytmusic: Any) -> None:
            for query, search_filter in requests:
                for candidate in ytmusic.search(query, filter=search_filter) or []:
                    video_id = candidate.get("videoId")
                    if video_id and video_id not in deduplicated:
                        deduplicated[video_id] = candidate
                    if len(deduplicated) >= self.max_candidates * (
                        len(requests) + 1
                    ):
                        return

        client = self.client_factory()
        if hasattr(client, "__enter__"):
            with client as ytmusic:
                collect(ytmusic)
        else:
            collect(client)
        return list(deduplicated.values())

    def _search(self, track: dict[str, Any]) -> list[dict[str, Any]]:
        spotify = spotify_metadata(track)
        query = f"{', '.join(spotify['artists'])} - {spotify['title']}"
        return self._search_requests([(query, "songs")])[: self.max_candidates]

    def _fallback_search(
        self,
        track: dict[str, Any],
        existing: Iterable[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        spotify = spotify_metadata(track)
        full_query = f"{', '.join(spotify['artists'])} - {spotify['title']}"
        requests = [(full_query, "videos")]
        if len(spotify["artists"]) > 1:
            primary_query = f"{spotify['artists'][0]} - {spotify['title']}"
            requests.extend(
                [
                    (primary_query, "songs"),
                    (primary_query, "videos"),
                ]
            )
        return self._search_requests(requests, existing=existing)

    def resolve(self, track: dict[str, Any]) -> dict[str, Any]:
        pinned = self.store.decision_for(track)
        if pinned is not None:
            return pinned
        try:
            candidates = self._search(track)
            decision = evaluate_candidates(track, candidates)
        except Exception as error:
            decision = evaluate_candidates(track, [])
            decision["reasons"] = [
                "search_failed",
                type(error).__name__,
            ]
        if decision["status"] != "verified" and "search_failed" not in decision["reasons"]:
            try:
                candidates = self._fallback_search(track, candidates)
                decision = evaluate_candidates(track, candidates)
            except Exception:
                # Preserve a valid initial decision when an optional fallback
                # provider request fails; a later refresh can retry it.
                pass
        self.store.save_decision(decision)
        return decision
