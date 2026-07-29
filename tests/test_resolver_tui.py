from pathlib import Path

from spotify_dl.resolver_eval import load_eval_set, save_eval_set
from spotify_dl.resolver_tui import ResolverReviewTUI


EVAL_PATH = Path(__file__).parents[1] / "evals" / "resolver" / "v1.json"


def test_tui_classification_persists_and_advances_without_audio(
    tmp_path,
    monkeypatch,
):
    source = load_eval_set(EVAL_PATH)
    for case in source["cases"]:
        case["label"]["state"] = "provisional"
    path = tmp_path / "eval.json"
    save_eval_set(path, source)
    reviewer = ResolverReviewTUI(path, autoplay=False)
    monkeypatch.setattr(reviewer.player, "play", lambda video_id: None)

    reviewer._save_classification("verified", ["C1Pkw5oChR0"])

    saved = load_eval_set(path)
    assert saved["cases"][0]["label"]["state"] == "gold"
    assert saved["cases"][0]["label"]["expected_status"] == "verified"
    assert saved["cases"][0]["label"]["expected_video_ids"] == ["C1Pkw5oChR0"]
    assert reviewer.case_index == 1
