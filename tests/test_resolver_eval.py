import copy
from pathlib import Path

import pytest

from spotify_dl.resolver_eval import (
    evaluate_eval_set,
    load_eval_set,
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
