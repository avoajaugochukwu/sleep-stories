"""Model loop for scene_director.

build prompt -> call model -> parse -> validate per scene -> bank the valid ones
-> resend ONLY the failures with a Fix Required block -> repeat up to
MAX_ATTEMPTS -> then raise.

Banking is per scene id, which matters here more than anywhere else: a chunk can
carry 20 scenes and one bad word in one of them must not force the other 19 to be
rewritten (and possibly rewritten worse).
"""

from __future__ import annotations

import sys

from pydantic import BaseModel, ConfigDict

from shared import config as shared_config
from shared import genres
from shared.llm import Refused, call_structured

from . import config
from .checks import parse_output, validate
from .prompt import GENRE_NEGATIVES, build_prompt


class _Scene(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int
    visual_context: str
    negative_prompt: str


class _DirectorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenes: list[_Scene]


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def direct(payload: dict, max_attempts: int | None = None) -> dict:
    """Write imagery for a batch of scenes.

    In:  {"context": {...}?, "genre": str?, "scenes": [{"id": int, "snippet": str}]}
    Out: {"scenes": [{"id", "visual_context", "negative_prompt"}]} in input order
    """
    context = payload.get("context") or {}
    # Genre travels on the context object when script_context produced it; the
    # top-level key is the override. One source, one fallback, no third path.
    genre = genres.normalize(payload.get("genre") or context.get("genre"))
    scenes = payload.get("scenes") or []
    attempts = config.MAX_ATTEMPTS if max_attempts is None else max_attempts

    # Before any model call — the health probe depends on this being free,
    # keyless and offline. See agents/CLAUDE.md.
    if not scenes:
        return {"scenes": []}

    by_id = {s["id"]: s for s in scenes if s.get("snippet", "").strip()}
    if not by_id:
        return {"scenes": []}

    order = [s["id"] for s in scenes if s["id"] in by_id]
    banked: dict[int, dict] = {}
    pending = list(order)

    prev_effort = shared_config.REASONING
    shared_config.REASONING = config.REASONING
    feedback = ""
    try:
        for attempt in range(1, attempts + 1):
            batch = [{"id": sid, "snippet": by_id[sid]["snippet"]} for sid in pending]
            messages = build_prompt(context, genre=genre, scenes=batch, feedback=feedback)
            try:
                raw = call_structured(messages, _DirectorOutput)
            except Refused as e:
                raise RuntimeError(f"scene_director model refused: {e.reason}")

            answers = parse_output(raw)
            valid_ids, problems = validate(answers, pending)
            for sid in valid_ids:
                banked[sid] = answers[sid]
            pending = [sid for sid in pending if sid not in banked]

            if not pending:
                _log(
                    f"[director] valid on attempt {attempt} "
                    f"(genre={genre}, {len(banked)} scenes)"
                )
                return {"scenes": _finish(order, banked, genre)}

            _log(
                f"[director] attempt {attempt}: banked {len(valid_ids)}, "
                f"{len(pending)} still failing; retrying"
            )
            feedback = (
                "Your last answer failed deterministic checks on these scenes. The "
                "scenes not listed here were accepted and are not being asked "
                "again:\n" + "\n".join(f"- {p}" for p in problems)
            )
    finally:
        shared_config.REASONING = prev_effort

    raise RuntimeError(
        f"scene_director failed validation for scenes {pending} after {attempts} "
        f"attempts:\n{feedback}"
    )


def _finish(order: list[int], banked: dict[int, dict], genre: str) -> list[dict]:
    """Return answers in input order with the genre's constant negatives appended.

    Constant per genre, so spending model tokens (and a possible retry round) on
    the model remembering to write them would be waste. It is appended anyway
    even when the model DID write them, because the guarantee has to hold on the
    call where it forgets.

    Terms are deduped case-insensitively, since the prompt tells the model to
    write these and it usually obliges — the first live run emitted
    "cartoon planets, lens flare starbursts, ... , cartoon planets,
    lens flare starburst". Exact-term dedupe only: a near-miss like the
    singular/plural pair above still slips through, and a stemmer is not worth
    writing for a negative prompt where a duplicate is merely untidy.
    """
    tail = GENRE_NEGATIVES.get(genre, "")
    out = []
    for sid in order:
        a = banked[sid]
        terms: list[str] = []
        seen: set[str] = set()
        for t in f"{a['negative_prompt']}, {tail}".split(","):
            t = t.strip()
            key = t.lower()
            if t and key not in seen:
                seen.add(key)
                terms.append(t)
        out.append(
            {
                "id": sid,
                "visual_context": a["visual_context"],
                "negative_prompt": ", ".join(terms),
            }
        )
    return out
