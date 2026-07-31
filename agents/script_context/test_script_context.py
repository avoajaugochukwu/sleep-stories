"""Offline tests for script_context's deterministic half.

    python3 agents/script_context/test_script_context.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from script_context.checks import parse_output, validate  # noqa: E402
from script_context.prompt import build_prompt  # noqa: E402
from script_context.schema import (  # noqa: E402
    GROUNDING_MAX_WORDS,
    MAX_RECURRING_SUBJECTS,
    SUMMARY_MAX_WORDS,
    SUMMARY_MIN_WORDS,
)
from shared import genres  # noqa: E402

SUMMARY = " ".join(["word"] * (SUMMARY_MIN_WORDS + 5))
GROUNDING = "France, 1916. Wool service dress, no plastic, no electric light at the front."


def _ctx(summary=SUMMARY, grounding=GROUNDING, subjects=None):
    return parse_output(
        {
            "summary": summary,
            "grounding": grounding,
            "recurring_subjects": subjects if subjects is not None else ["the field hospital"],
        }
    )


def test_good_context_validates():
    assert validate(_ctx(), "history") == []


def test_summary_too_short():
    problems = validate(_ctx(summary="too short"), "history")
    assert any(f"at least {SUMMARY_MIN_WORDS}" in p for p in problems), problems


def test_summary_too_long():
    long = " ".join(["word"] * (SUMMARY_MAX_WORDS + 10))
    problems = validate(_ctx(summary=long), "history")
    assert any(f"at most {SUMMARY_MAX_WORDS}" in p for p in problems), problems


def test_grounding_too_long():
    long = " ".join(["word"] * (GROUNDING_MAX_WORDS + 10))
    problems = validate(_ctx(grounding=long), "space")
    assert any(f"at most {GROUNDING_MAX_WORDS}" in p for p in problems), problems


def test_grounded_genre_requires_grounding():
    # The failure this catches: the agent does the easy half (a summary) and
    # leaves every downstream scene unanchored.
    for g in ("history", "space"):
        problems = validate(_ctx(grounding=""), g)
        assert any("`grounding` is empty" in p for p in problems), (g, problems)


def test_abstract_genre_may_be_ungrounded():
    assert "abstract" in genres.UNGROUNDED
    assert validate(_ctx(grounding=""), "abstract") == []


def test_recurring_subjects_capped():
    many = [f"subject {i}" for i in range(MAX_RECURRING_SUBJECTS + 3)]
    problems = validate(_ctx(subjects=many), "history")
    assert any("recurring_subjects" in p for p in problems), problems


def test_recurring_subjects_deduped_case_insensitively():
    ctx = _ctx(subjects=["The Somme", "the somme", "  ", "A Field Hospital"])
    assert ctx["recurring_subjects"] == ["The Somme", "A Field Hospital"]


def test_empty_subject_list_is_valid():
    # A script that never revisits a subject is a real script, not an error.
    assert validate(_ctx(subjects=[]), "history") == []


def test_genre_changes_the_grounding_instruction():
    hist = build_prompt("script", "history")[0]["content"]
    space = build_prompt("script", "space")[0]["content"]
    assert hist != space
    assert "exact year or decade" in hist
    assert "vacuum" in space


# ── genre inference ─────────────────────────────────────────────────────────
# The point of this agent: a new kind of video should not need a code change or
# a Baserow column to look right.

def test_no_genre_asks_the_model_to_classify():
    system = build_prompt("script", None)[0]["content"]
    assert "`genre` — classify this script" in system
    # every genre must be offered, or one becomes unreachable by inference
    for g in genres.GENRES:
        assert f"`{g}`" in system, g
    # and all three grounding briefs must be present, since the model grounds
    # against whichever it picks in the same pass
    assert "exact year or decade" in system and "vacuum" in system


def test_pinned_genre_omits_the_menu():
    system = build_prompt("script", "space")[0]["content"]
    assert "classify this script" not in system
    # pinning space must not smuggle the history brief in alongside it
    assert "exact year or decade" not in system


def test_overlay_pack_derives_from_genre():
    # No agent picks overlays. Clips are prefixed by pack in public/overlays, so
    # genre -> pack is a lookup; a model call here would decide nothing extra.
    assert genres.overlay_pack("space") == "space"
    assert genres.overlay_pack("history") == "fire"
    # abstract is neutral: smoke sits under anything, cosmic footage does not
    assert genres.overlay_pack("abstract") == "fire"
    # unknown / missing must never return a pack that has no clips
    assert genres.overlay_pack("cooking") == genres.DEFAULT_PACK
    assert genres.overlay_pack(None) == genres.DEFAULT_PACK


def test_every_genre_maps_to_a_pack():
    for g in genres.GENRES:
        assert g in genres.OVERLAY_PACK, f"{g} has no overlay pack"


def test_feedback_appends_fix_block():
    msgs = build_prompt("script", "history", feedback="- summary too long")
    assert "## Fix Required" in msgs[1]["content"]


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"script_context: {len(tests)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
