import copy
from pathlib import Path

import pytest

from spotify_dl.resolver_eval import (
    evaluate_eval_set,
    label_for_resolver_result,
    load_eval_set,
    save_eval_set,
    set_gold_label,
    validate_eval_set,
)


EVAL_PATH = Path(__file__).parents[1] / "evals" / "resolver" / "v1.json"


def test_seed_eval_is_valid_and_runs_offline():
    report = evaluate_eval_set(load_eval_set(EVAL_PATH))

    assert report["summary"] == {
        "total_cases": 9,
        "label_states": {
            "gold": 0,
            "provisional": 6,
            "needs_review": 3,
        },
        "predicted_statuses": {
            "verified": 3,
            "rejected": 5,
            "ambiguous": 1,
        },
        "gold_total": 0,
        "gold_passed": 0,
        "gold_failed": 0,
        "gold_accuracy": None,
    }


def test_only_gold_labels_contribute_to_metrics():
    eval_set = load_eval_set(EVAL_PATH)
    promoted = copy.deepcopy(eval_set)
    promoted["cases"][0]["label"]["state"] = "gold"
    promoted["cases"][1]["label"]["state"] = "gold"
    promoted["cases"][1]["label"]["expected_status"] = "rejected"
    promoted["cases"][1]["label"]["expected_video_ids"] = []

    report = evaluate_eval_set(promoted)

    assert report["summary"]["gold_total"] == 2
    assert report["summary"]["gold_passed"] == 1
    assert report["summary"]["gold_failed"] == 1
    assert report["summary"]["gold_accuracy"] == 0.5


def test_duplicate_case_ids_are_rejected():
    eval_set = load_eval_set(EVAL_PATH)
    invalid = copy.deepcopy(eval_set)
    invalid["cases"][1]["case_id"] = invalid["cases"][0]["case_id"]

    with pytest.raises(ValueError, match="duplicate case_id"):
        validate_eval_set(invalid)


def test_empty_candidate_lists_are_allowed_only_before_capture():
    eval_set = load_eval_set(EVAL_PATH)
    invalid = copy.deepcopy(eval_set)
    invalid["cases"][0]["candidates"] = []

    validate_eval_set(invalid, require_candidates=False)
    with pytest.raises(ValueError, match="candidates cannot be empty"):
        validate_eval_set(invalid)


def test_human_classification_is_validated_and_saved_atomically(tmp_path):
    eval_set = load_eval_set(EVAL_PATH)
    case = eval_set["cases"][0]

    set_gold_label(
        case,
        "verified",
        ["C1Pkw5oChR0"],
        reviewed_at="2026-07-29T05:00:00Z",
    )
    destination = tmp_path / "eval.json"
    save_eval_set(destination, eval_set)

    saved_case = load_eval_set(destination)["cases"][0]
    assert saved_case["label"] == {
        "state": "gold",
        "expected_status": "verified",
        "expected_video_ids": ["C1Pkw5oChR0"],
        "provenance": "human review via resolver eval TUI",
        "notes": "Clean exact-title, artist, album, and duration match.",
        "reviewed_at": "2026-07-29T05:00:00Z",
    }
    assert not list(tmp_path.glob("*.tmp"))


def test_ambiguous_human_label_requires_two_captured_candidates():
    eval_set = load_eval_set(EVAL_PATH)

    with pytest.raises(ValueError, match="at least two"):
        set_gold_label(
            eval_set["cases"][0],
            "ambiguous",
            ["C1Pkw5oChR0"],
        )


def test_accepting_resolver_result_produces_matching_label():
    report = evaluate_eval_set(load_eval_set(EVAL_PATH))
    verified = report["cases"][0]
    rejected = report["cases"][2]
    ambiguous = report["cases"][5]

    assert label_for_resolver_result(verified) == (
        "verified",
        ["C1Pkw5oChR0"],
    )
    assert label_for_resolver_result(rejected) == ("rejected", [])
    status, video_ids = label_for_resolver_result(ambiguous)
    assert status == "ambiguous"
    assert set(video_ids) == {"WCfanCc1dzw", "MdjXljT13Bc"}
