"""Offline tests for scene_splitter's deterministic half.

    python3 agents/scene_splitter/test_scene_splitter.py

No pytest, no network, no API key, and `openai` need not be installed — importing
checks must not pull shared/llm.py into the graph.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scene_splitter.checks import (  # noqa: E402
    close_coverage_gaps,
    expected_scene_count,
    heal_snippet,
    validate,
)

CHUNK = (
    "The lamp burned low in the window. Outside, the snow had begun again, "
    "soft and unhurried. He set down his pen and listened to the quiet."
)


def test_heal_exact_passthrough():
    s = "The lamp burned low in the window."
    assert heal_snippet(s, CHUNK) == s


def test_heal_whitespace_variant():
    # The model re-wrapped the text; the real slice must come back.
    mangled = "Outside,  the snow   had begun again,\nsoft and unhurried."
    healed = heal_snippet(mangled, CHUNK)
    assert healed in CHUNK, healed
    assert "snow had begun again" in healed


def test_heal_unanchorable_returns_input():
    # Paraphrased — nothing to anchor to. Must NOT be guessed at; validation
    # catches it instead.
    s = "The lantern was dim by the glass."
    assert heal_snippet(s, CHUNK) == s


def test_close_gaps_leading_middle_trailing():
    # Model dropped the first sentence, a middle space run, and the last clause.
    parts = ["Outside, the snow had begun again,", "He set down his pen"]
    out = close_coverage_gaps(parts, CHUNK)
    assert "".join(out) == CHUNK, "".join(out)


def test_close_gaps_absorbs_whitespace_only_gaps():
    # The model returns trimmed sentences and drops the space between them on
    # essentially every call. Byte-exact reassembly is the contract, so those
    # single-space gaps must be absorbed — skipping them made the contract
    # unreachable and burned every retry attempt on a live run.
    parts = [
        "The lamp burned low in the window.",
        "Outside, the snow had begun again, soft and unhurried.",
        "He set down his pen and listened to the quiet.",
    ]
    out = close_coverage_gaps(parts, CHUNK)
    assert "".join(out) == CHUNK, "".join(out)


def test_close_gaps_absorbs_leading_and_trailing_whitespace():
    chunk = "  A quiet room.  "
    out = close_coverage_gaps(["A quiet room."], chunk)
    assert "".join(out) == chunk, repr("".join(out))


def test_close_gaps_is_pure():
    parts = ["He set down his pen"]
    original = list(parts)
    close_coverage_gaps(parts, CHUNK)
    assert parts == original, "close_coverage_gaps must not mutate its input"


def test_close_gaps_repeated_phrase_resolves_each_occurrence():
    # The TS original used indexOf from 0, so the SECOND "the night was still."
    # resolved to the first and the computed gaps were nonsense. This is the
    # deviation documented at the top of checks.py — assert it stays fixed.
    chunk = "the night was still. A fox crossed the road. the night was still."
    parts = ["the night was still.", " A fox crossed the road.", " the night was still."]
    out = close_coverage_gaps(parts, chunk)
    assert "".join(out) == chunk, "".join(out)


def test_validate_accepts_exact_cover():
    parts = [
        "The lamp burned low in the window.",
        " Outside, the snow had begun again, soft and unhurried.",
        " He set down his pen and listened to the quiet.",
    ]
    # CHUNK is 26 words, so 3 scenes is only reasonable at a short target.
    assert "".join(parts) == CHUNK
    assert validate(parts, CHUNK, target_seconds=4.0) == []


def test_validate_rejects_missing_text():
    parts = ["The lamp burned low in the window."]
    problems = validate(parts, CHUNK, target_seconds=8.0)
    assert any("does not reproduce the chunk" in p for p in problems), problems


def test_validate_rejects_paraphrase():
    parts = ["The lantern burned low in the window.", " and the rest"]
    problems = validate(parts, CHUNK, target_seconds=8.0)
    assert any("character-for-character" in p for p in problems), problems


def test_validate_flags_whitespace_only_difference_distinctly():
    parts = ["The lamp burned  low in the window. Outside, the snow had begun again, soft and unhurried. He set down his pen and listened to the quiet."]
    problems = validate(parts, CHUNK, target_seconds=60.0)
    assert any("only in whitespace" in p for p in problems), problems


def test_validate_rejects_empty():
    problems = validate([], CHUNK)
    assert problems and "no snippets" in problems[0]


def test_validate_rejects_staccato():
    # One scene per sentence on a chunk that should hold ~1 scene.
    parts = [
        "The lamp burned low in the window.",
        " Outside, the snow had begun again, soft and unhurried.",
        " He set down his pen and listened to the quiet.",
    ]
    problems = validate(parts, CHUNK, target_seconds=120.0)
    assert any("Never one scene per sentence" in p for p in problems), problems


def test_expected_count_scales_with_length():
    assert expected_scene_count(CHUNK, 20.0) < expected_scene_count(CHUNK * 4, 20.0)
    assert expected_scene_count("", 20.0) >= 1.0


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"scene_splitter: {len(tests)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
