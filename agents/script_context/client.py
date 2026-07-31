"""Model loop for script_context.

build prompt -> call model -> parse -> validate -> on failure feed the problems
back into a Fix Required block -> retry up to MAX_ATTEMPTS -> then raise.

One call per script, so there is no chunking and no banking — the unit of work is
indivisible.

shared.llm reads shared.config.REASONING at call time, so build() swaps in this
agent's own effort for the duration of the run and restores it after, without
editing shared/config.py.
"""

from __future__ import annotations

import enum
import sys

from pydantic import BaseModel, ConfigDict

from shared import config as shared_config
from shared import genres
from shared.llm import Refused, call_structured

from . import config
from .checks import parse_output, validate
from .prompt import build_prompt


_Genre = enum.Enum("Genre", {g: g for g in genres.GENRES})


class _ContextOutput(BaseModel):
    """The model's output shape when it is also classifying. Structured Outputs
    constrains `genre` to the enum, so an invented genre is impossible; checks.py
    still enforces the semantic rules (word bands, caps) that shape can't
    express."""

    model_config = ConfigDict(extra="forbid")
    genre: _Genre
    summary: str
    grounding: str
    recurring_subjects: list[str]


class _ContextOutputPinned(BaseModel):
    """Same, minus `genre` — the caller already decided it, and leaving the field
    in would invite the model to disagree with an override that exists precisely
    to overrule it."""

    model_config = ConfigDict(extra="forbid")
    summary: str
    grounding: str
    recurring_subjects: list[str]


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def build(payload: dict, max_attempts: int | None = None) -> dict:
    """Build the grounding context for one script.

    In:  {"script": str, "genre": str?}
    Out: {"summary", "grounding", "recurring_subjects", "genre", "overlay_pack"}

    `genre` is INFERRED from the script unless the payload pins it. Passing one
    is an override for when a human knows better, not the normal path — the whole
    point is that a new kind of video does not need a code change or a Baserow
    column to look right.

    `overlay_pack` is derived, not asked for: with clips prefixed by pack in
    public/overlays, "which overlays" is a lookup on the genre. It rides on this
    result so the caller threads one object to both scene_director and the
    renderer instead of recomputing and drifting.
    """
    script = (payload.get("script") or "").strip()
    pinned = payload.get("genre")
    genre = genres.normalize(pinned) if pinned else None
    attempts = config.MAX_ATTEMPTS if max_attempts is None else max_attempts

    # Before any model call — the health probe depends on this being free,
    # keyless and offline. See agents/CLAUDE.md.
    if not script:
        g = genre or genres.DEFAULT_GENRE
        return {
            "summary": "",
            "grounding": "",
            "recurring_subjects": [],
            "genre": g,
            "overlay_pack": genres.overlay_pack(g),
        }

    prev_effort = shared_config.REASONING
    shared_config.REASONING = config.REASONING
    feedback = ""
    try:
        for attempt in range(1, attempts + 1):
            messages = build_prompt(script, genre=genre, feedback=feedback)
            try:
                raw = call_structured(
                    messages, _ContextOutputPinned if genre else _ContextOutput
                )
            except Refused as e:
                raise RuntimeError(f"script_context model refused: {e.reason}")

            # A pinned genre wins outright; otherwise take what the model chose.
            # normalize() is belt and braces — Structured Outputs already
            # constrained it to the enum.
            chosen = genre or genres.normalize(raw.get("genre"))
            ctx = parse_output(raw)
            problems = validate(ctx, chosen)
            if not problems:
                _log(
                    f"[context] valid on attempt {attempt} (genre={chosen}"
                    f"{'' if genre else ' inferred'}, pack={genres.overlay_pack(chosen)}, "
                    f"{len(ctx['recurring_subjects'])} recurring subjects)"
                )
                return {
                    **ctx,
                    "genre": chosen,
                    "overlay_pack": genres.overlay_pack(chosen),
                }

            _log(f"[context] attempt {attempt} failed {len(problems)} checks; retrying")
            feedback = "Your last answer failed deterministic checks:\n" + "\n".join(
                f"- {p}" for p in problems
            )
    finally:
        shared_config.REASONING = prev_effort

    raise RuntimeError(
        f"script_context failed validation after {attempts} attempts:\n{feedback}"
    )
