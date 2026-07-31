"""Deterministic rules for script_context.

Nothing here calls a model, and this module must import without the openai SDK.
"""

from __future__ import annotations

from shared import genres

from .schema import (
    GROUNDING_MAX_WORDS,
    MAX_RECURRING_SUBJECTS,
    SUMMARY_MAX_WORDS,
    SUMMARY_MIN_WORDS,
)


def _words(text: str) -> int:
    return len(text.split())


def parse_output(raw: dict) -> dict:
    """Structured Outputs guarantees the shape; this only trims and de-dupes."""
    subjects: list[str] = []
    seen: set[str] = set()
    for s in raw.get("recurring_subjects") or []:
        s = (s or "").strip()
        key = s.lower()
        if s and key not in seen:
            seen.add(key)
            subjects.append(s)
    return {
        "summary": (raw.get("summary") or "").strip(),
        "grounding": (raw.get("grounding") or "").strip(),
        "recurring_subjects": subjects,
    }


def validate(ctx: dict, genre: str) -> list[str]:
    """Return a list of problems. Empty means valid.

    Each string names what is wrong and what to do, because these go verbatim
    into the repair prompt.
    """
    problems: list[str] = []

    summary_words = _words(ctx["summary"])
    if summary_words < SUMMARY_MIN_WORDS:
        problems.append(
            f"`summary` is {summary_words} words; write at least {SUMMARY_MIN_WORDS} "
            "covering the central topic, the tone, and the setting."
        )
    elif summary_words > SUMMARY_MAX_WORDS:
        problems.append(
            f"`summary` is {summary_words} words; cut it to at most {SUMMARY_MAX_WORDS}. "
            "It is prepended to every scene prompt, so length here is paid per chunk."
        )

    grounding_words = _words(ctx["grounding"])
    if grounding_words > GROUNDING_MAX_WORDS:
        problems.append(
            f"`grounding` is {grounding_words} words; cut it to at most "
            f"{GROUNDING_MAX_WORDS}. Keep the constraints, drop the prose."
        )

    # An ungrounded genre (abstract) is the ONLY case where empty is correct.
    # Everywhere else an empty grounding means the agent did the easy half only,
    # and every downstream scene is then unanchored.
    if genre not in genres.UNGROUNDED and grounding_words == 0:
        problems.append(
            f"`grounding` is empty, but the genre is `{genre}`, which has physical "
            "constraints. State them — for `history` the era, place and the "
            "technology that did and did not exist; for `space` the scale, the real "
            "light sources and what a vacuum does to them."
        )

    if len(ctx["recurring_subjects"]) > MAX_RECURRING_SUBJECTS:
        problems.append(
            f"`recurring_subjects` has {len(ctx['recurring_subjects'])} entries; keep "
            f"the {MAX_RECURRING_SUBJECTS} that actually recur and drop the rest."
        )

    return problems
