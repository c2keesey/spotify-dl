"""Run a captured resolver eval set without network access."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from spotify_dl.resolver_eval import evaluate_eval_set, load_eval_set


DEFAULT_PATH = Path("evals/resolver/v1.json")


def render_review(report: dict[str, Any], candidate_limit: int) -> str:
    summary = report["summary"]
    lines = [
        f"# Resolver eval: {report['dataset']}",
        "",
        (
            f"{summary['total_cases']} cases: "
            f"{summary['label_states']['gold']} gold, "
            f"{summary['label_states']['provisional']} provisional, "
            f"{summary['label_states']['needs_review']} needs review."
        ),
        (
            "Gold score: "
            + (
                f"{summary['gold_passed']}/{summary['gold_total']} "
                f"({summary['gold_accuracy']:.1%})"
                if summary["gold_total"]
                else "not calculated until labels are promoted to gold"
            )
        ),
        "",
    ]

    for result in report["cases"]:
        label = result["label"]
        spotify = result["spotify"]
        actual = result["actual"]
        expected_ids = ", ".join(label["expected_video_ids"]) or "none"
        lines.extend(
            [
                f"## {result['case_id']} [{label['state']}]",
                "",
                f"Spotify: {', '.join(spotify['artists'])} — {spotify['title']}",
                (
                    f"Expected hypothesis: {label['expected_status']} "
                    f"(video: {expected_ids})"
                ),
                (
                    f"Resolver: {actual['status']} "
                    f"(video: {actual['video_id'] or 'none'})"
                ),
                f"Observed agreement: {'yes' if result['observed_agreement'] else 'no'}",
                f"Review note: {label.get('notes') or 'none'}",
                "",
                "Top candidates:",
            ]
        )
        for candidate in result["candidates"][:candidate_limit]:
            source = candidate["source"]
            scores = candidate["scores"]
            failed_gates = ", ".join(candidate["rejection_reasons"]) or "none"
            lines.append(
                (
                    f"- [{source['video_id']}]"
                    f"(https://music.youtube.com/watch?v={source['video_id']}) "
                    f"{', '.join(source['artists'])} — {source['title']} "
                    f"({source['duration_ms']} ms, score "
                    f"{scores['overall']:.3f}, failed: {failed_gates})"
                )
            )
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--candidate-limit", type=int, default=3)
    args = parser.parse_args()
    report = evaluate_eval_set(load_eval_set(args.path))
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(render_review(report, max(1, args.candidate_limit)))


if __name__ == "__main__":
    main()
