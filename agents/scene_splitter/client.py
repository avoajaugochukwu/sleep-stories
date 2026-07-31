"""Model loop for scene_splitter.

build prompt -> call model -> heal -> close gaps -> validate -> on failure feed
the problems back into a Fix Required block -> retry up to MAX_ATTEMPTS -> raise.

Heal and gap-closing run BEFORE validation on every attempt. They are
deterministic repairs with one correct answer each, not guesses, and without them
byte-exact coverage is not reachable in practice — the model reliably drops a
trailing space or a line break. Validation still has to pass afterwards, so a
genuinely wrong split still fails.

No banking here: a chunk's snippets are one interlocking answer (they must
concatenate to the whole chunk), so there is no per-item unit to bank.
"""

from __future__ import annotations

import sys

from pydantic import BaseModel, ConfigDict

from shared import config as shared_config
from shared.llm import Refused, call_structured

from . import config
from .checks import close_coverage_gaps, heal_snippet, validate
from .prompt import build_prompt
from .schema import TARGET_SECONDS, WORDS_PER_SECOND


class _SplitOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    snippets: list[str]


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def split(payload: dict, max_attempts: int | None = None) -> dict:
    """Split one chunk into scene snippets.

    In:  {"chunk_text": str, "context": {...}?, "target_seconds": float?}
    Out: {"snippets": [str]}  — concatenating them reproduces chunk_text exactly
    """
    chunk_text = payload.get("chunk_text") or ""
    context = payload.get("context") or {}
    target_seconds = float(payload.get("target_seconds") or TARGET_SECONDS)
    attempts = config.MAX_ATTEMPTS if max_attempts is None else max_attempts

    # Before any model call — the health probe depends on this being free,
    # keyless and offline. See agents/CLAUDE.md.
    if not chunk_text.strip():
        return {"snippets": []}

    words_per_scene = round(target_seconds * WORDS_PER_SECOND)

    prev_effort = shared_config.REASONING
    shared_config.REASONING = config.REASONING
    feedback = ""
    try:
        for attempt in range(1, attempts + 1):
            messages = build_prompt(
                chunk_text,
                context=context,
                target_seconds=target_seconds,
                words_per_scene=words_per_scene,
                feedback=feedback,
            )
            try:
                raw = call_structured(messages, _SplitOutput)
            except Refused as e:
                raise RuntimeError(f"scene_splitter model refused: {e.reason}")

            healed = [heal_snippet(s, chunk_text) for s in raw.get("snippets") or []]
            snippets = close_coverage_gaps(healed, chunk_text)

            problems = validate(snippets, chunk_text, target_seconds)
            if not problems:
                _log(
                    f"[splitter] valid on attempt {attempt} "
                    f"({len(snippets)} scenes, {len(chunk_text)} chars covered)"
                )
                return {"snippets": snippets}

            _log(f"[splitter] attempt {attempt} failed {len(problems)} checks; retrying")
            feedback = "Your last answer failed deterministic checks:\n" + "\n".join(
                f"- {p}" for p in problems
            )
    finally:
        shared_config.REASONING = prev_effort

    raise RuntimeError(
        f"scene_splitter failed validation after {attempts} attempts:\n{feedback}"
    )
