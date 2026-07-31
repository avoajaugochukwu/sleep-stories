"""Model loop for scene_director.

Takes every scene in the video in ONE spawn and chunks them internally, because
chunk size decides what a single model call sees and that is a prompt decision,
not the caller's.

Per chunk: build prompt -> call model -> validate per scene -> bank the valid
ones -> resend ONLY the failures with a Fix Required block -> repeat up to
MAX_ATTEMPTS. Banking is per scene id, which matters here more than anywhere
else: a chunk carries several scenes and one bad word in one of them must not
force the others to be rewritten (and possibly rewritten worse).

Then, for anything still unresolved, one solo retry per scene so a single bad
beat cannot take its chunk-mates down with it.

**A scene that still has no imagery inherits its nearest directed neighbour's**
rather than failing the video. Modal already does exactly this one layer down —
a scene whose image failed to generate reuses the previous scene's image so
audio coverage is never lost (`render-modal/modal_app.py`). Repeating an image
for one beat of a two-hour sleep video is a duller minute; a failed job is no
video. This is a sanctioned degradation and it is logged loudly as SALVAGED;
see agents/CLAUDE.md.
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor

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


def _direct_chunk(
    context: dict,
    genre: str,
    by_id: dict[int, dict],
    ids: list[int],
    attempts: int,
) -> dict[int, dict]:
    """Run the bank-and-repair loop over one chunk. Returns what it resolved."""
    banked: dict[int, dict] = {}
    pending = list(ids)
    feedback = ""

    for attempt in range(1, attempts + 1):
        batch = [{"id": sid, "snippet": by_id[sid]["snippet"]} for sid in pending]
        messages = build_prompt(context, genre=genre, scenes=batch, feedback=feedback)
        try:
            raw = call_structured(messages, _DirectorOutput)
        except Refused as e:
            _log(f"[director] scenes {pending} refused ({e.reason})")
            break
        except Exception as e:  # noqa: BLE001 — transport/parse; salvage handles it
            _log(f"[director] scenes {pending} errored ({type(e).__name__}: {e})")
            break

        answers = parse_output(raw)
        valid_ids, problems = validate(answers, pending)
        for sid in valid_ids:
            banked[sid] = answers[sid]
        pending = [sid for sid in pending if sid not in banked]

        if not pending:
            return banked

        _log(
            f"[director] attempt {attempt}: banked {len(valid_ids)}, "
            f"{len(pending)} still failing; retrying"
        )
        feedback = (
            "Your last answer failed deterministic checks on these scenes. The "
            "scenes not listed here were accepted and are not being asked "
            "again:\n" + "\n".join(f"- {p}" for p in problems)
        )

    return banked


def direct(payload: dict, max_attempts: int | None = None) -> dict:
    """Write imagery for every scene in a video.

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
    chunks = [
        order[i : i + config.CHUNK_SIZE] for i in range(0, len(order), config.CHUNK_SIZE)
    ]

    prev_effort = shared_config.REASONING
    shared_config.REASONING = config.REASONING
    try:
        with ThreadPoolExecutor(
            max_workers=min(len(chunks), config.MAX_PARALLEL_CHUNKS)
        ) as pool:
            results = pool.map(
                lambda ids: _direct_chunk(context, genre, by_id, ids, attempts), chunks
            )
        banked: dict[int, dict] = {}
        for part in results:
            banked.update(part)

        # One solo round, so a scene is only given up on after being asked alone.
        solo = [sid for sid in order if sid not in banked]
        if solo:
            _log(f"[director] {len(solo)} scenes unresolved in their chunk; retrying alone")
            with ThreadPoolExecutor(
                max_workers=min(len(solo), config.MAX_PARALLEL_CHUNKS)
            ) as pool:
                for part in pool.map(
                    lambda sid: _direct_chunk(context, genre, by_id, [sid], attempts), solo
                ):
                    banked.update(part)
    finally:
        shared_config.REASONING = prev_effort

    if not banked:
        # Nothing came back at all — the model or the network is down, and there
        # is no neighbour to inherit from. This one does fail the job.
        raise RuntimeError(
            f"scene_director resolved 0 of {len(order)} scenes; no imagery to salvage"
        )

    salvaged = _fill_gaps(order, banked)
    if salvaged:
        _log(
            f"[director] SALVAGED — {len(salvaged)} of {len(order)} scenes reuse a "
            f"neighbour's imagery: {salvaged}"
        )
    _log(f"[director] {len(order)} scenes directed (genre={genre})")
    return {"scenes": _finish(order, banked, genre)}


def _fill_gaps(order: list[int], banked: dict[int, dict]) -> list[int]:
    """Give every undirected scene its nearest directed neighbour's imagery.

    Previous scene first, next scene otherwise — a repeat reads as a held shot
    when it follows its original and as a jump when it precedes it. Mutates
    `banked`; returns the ids that were filled.
    """
    filled: list[int] = []
    previous: dict | None = None
    for sid in order:
        if sid in banked:
            previous = banked[sid]
        elif previous is not None:
            banked[sid] = previous
            filled.append(sid)

    # Anything before the first directed scene has no previous to inherit from.
    following: dict | None = None
    for sid in reversed(order):
        if sid in banked and sid not in filled:
            following = banked[sid]
        elif sid not in banked and following is not None:
            banked[sid] = following
            filled.append(sid)
    return sorted(filled)


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
