"""Offline tests for scene_director's deterministic half.

    python3 agents/scene_director/test_scene_director.py

No pytest, no network, no API key, and `openai` need not be installed.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scene_director.checks import parse_output, validate  # noqa: E402
from scene_director.prompt import (  # noqa: E402
    GENRE_BRIEFS,
    GENRE_NEGATIVES,
    build_prompt,
)
from scene_director.schema import MAX_WORDS, MIN_WORDS  # noqa: E402
from shared import genres  # noqa: E402

GOOD = (
    "A single oil lamp on a plain wooden sill, its small flame the only light in "
    "the room, throwing a warm amber pool across the grain of the wood and fading "
    "into deep blue darkness at the edges of the frame, snow visible as soft pale "
    "drift against the black glass behind it, quiet and still"
)


def _answer(vc=GOOD, neg="modern lighting, plastic", sid=1):
    return {"scenes": [{"id": sid, "visual_context": vc, "negative_prompt": neg}]}


def test_good_scene_validates():
    valid, problems = validate(parse_output(_answer()), [1])
    assert problems == [], problems
    assert valid == [1]


def test_word_band_enforced():
    _, short = validate(parse_output(_answer(vc="A lamp.")), [1])
    assert any(f"at least {MIN_WORDS}" in p for p in short), short
    _, long = validate(parse_output(_answer(vc=" ".join(["lamp"] * (MAX_WORDS + 5)))), [1])
    assert any(f"at most {MAX_WORDS}" in p for p in long), long


def test_style_words_rejected():
    # STYLE_PREFIX is prepended by lib/jobs/scene-image.ts; a second style
    # declaration here fights it.
    _, problems = validate(parse_output(_answer(vc=GOOD + ", cinematic 35mm photo")), [1])
    assert any("style/medium/camera" in p for p in problems), problems


def test_digital_painting_rejected():
    # The exact live failure: STYLE_PREFIX is "highly detailed digital painting, ",
    # so a scene that also says it produces a doubled prompt. 44% of the Somme
    # job's scenes did. Regression-pin it.
    _, problems = validate(parse_output(_answer(vc="highly detailed digital painting: " + GOOD)), [1])
    assert any("style/medium/camera" in p for p in problems), problems


def test_style_check_is_word_anchored():
    # "camera" is banned; "cameraderie"-style substrings must not trip it, or the
    # denylist gets deleted by the next person for crying wolf.
    valid, problems = validate(parse_output(_answer(vc=GOOD + " and a photographer's satchel")), [1])
    assert problems == [], problems


def test_sfw_denylist_rejects():
    _, problems = validate(parse_output(_answer(vc=GOOD + " beside a corpse")), [1])
    assert any("banned imagery" in p for p in problems), problems


def test_text_in_image_rejected():
    _, problems = validate(parse_output(_answer(vc=GOOD + " with a watermark")), [1])
    assert any("text in the image" in p for p in problems), problems


def test_empty_negative_rejected():
    _, problems = validate(parse_output(_answer(neg="")), [1])
    assert any("negative_prompt is empty" in p for p in problems), problems


def test_missing_scene_reported():
    _, problems = validate(parse_output(_answer(sid=1)), [1, 2])
    assert any("Scene 2 is missing" in p for p in problems), problems


def test_unrequested_scene_reported():
    _, problems = validate(parse_output(_answer(sid=9)), [1])
    assert any("not requested" in p for p in problems), problems


def test_banking_isolates_failures():
    raw = {
        "scenes": [
            {"id": 1, "visual_context": GOOD, "negative_prompt": "plastic"},
            {"id": 2, "visual_context": "too short", "negative_prompt": "plastic"},
        ]
    }
    valid, problems = validate(parse_output(raw), [1, 2])
    assert valid == [1], valid
    assert len(problems) == 1 and problems[0].startswith("Scene 2"), problems


def test_duplicate_id_keeps_first():
    raw = {
        "scenes": [
            {"id": 1, "visual_context": GOOD, "negative_prompt": "first"},
            {"id": 1, "visual_context": GOOD, "negative_prompt": "second"},
        ]
    }
    assert parse_output(raw)[1]["negative_prompt"] == "first"


# ── The genre seam ──────────────────────────────────────────────────────────

def test_every_genre_has_a_brief_and_negatives():
    # This is the contract that keeps genre out of lib/. A genre registered
    # without a brief would silently fall back to history direction.
    for g in genres.GENRES:
        assert g in GENRE_BRIEFS, f"{g} has no brief in prompt.py"
        assert g in GENRE_NEGATIVES, f"{g} has no constant negatives in prompt.py"


def test_genre_changes_the_system_prompt():
    hist = build_prompt({}, "history", [{"id": 1, "snippet": "x"}])[0]["content"]
    space = build_prompt({}, "space", [{"id": 1, "snippet": "x"}])[0]["content"]
    assert hist != space
    assert "PERIOD AND PLACE ACCURACY" in hist
    assert "PHYSICAL ACCURACY IN SPACE" in space
    # The safety block is genre-independent and must survive every swap.
    assert "SAFE FOR A GENERAL AUDIENCE" in hist
    assert "SAFE FOR A GENERAL AUDIENCE" in space


def test_unknown_genre_falls_back_not_raises():
    assert genres.normalize("cooking") == genres.DEFAULT_GENRE
    assert genres.normalize(None) == genres.DEFAULT_GENRE
    assert genres.normalize("  SPACE ") == "space"


def test_prompt_carries_only_requested_ids():
    user = build_prompt({}, "space", [{"id": 4, "snippet": "a"}, {"id": 7, "snippet": "b"}])[1]["content"]
    assert "[4]" in user and "[7]" in user
    assert "Scenes to write (2)" in user


def test_finish_dedupes_genre_negatives():
    # The prompt asks the model for these terms, so it usually writes them and
    # they were landing twice. Import here: _finish lives in client.py, which
    # pulls pydantic — keep it out of the module-level import graph so the rest
    # of this file stays runnable without it.
    from scene_director.client import _finish

    banked = {
        1: {
            "id": 1,
            "visual_context": GOOD,
            "negative_prompt": "cartoon planets, twinkling stars, added moons",
        }
    }
    neg = _finish([1], banked, "space")[0]["negative_prompt"]
    assert neg.count("cartoon planets") == 1, neg
    assert neg.count("twinkling stars") == 1, neg
    assert "added moons" in neg
    # the genre constants still get in
    assert "lens flare starburst" in neg


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"scene_director: {len(tests)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
