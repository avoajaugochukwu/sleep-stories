"""Deterministic rules for scene_director.

Nothing here calls a model, and this module must import without the openai SDK.

## On the SFW check — read this before trusting it

The old prompt carried a `SFW MANDATE (ABSOLUTE)` block in prose. Prose is not
absolute; it is a suggestion the model weighs against everything else you asked
for. Moving it here makes it a clamp.

But be clear about what this clamp is: **a term denylist, not semantic safety.**
It reliably catches the model writing "blood" or "corpse". It cannot catch a
tastefully-worded sentence describing something that should not be drawn.

The real backstop is unchanged and lives elsewhere: `SFW_NEGATIVE` inside
`BASE_NEGATIVE` in `lib/jobs/scene-image.ts`, applied to every image regardless
of what any agent emitted. Two independent gates. Neither is trusted alone, and
neither should be removed because the other exists.
"""

from __future__ import annotations

import re

from .schema import (
    MAX_NEGATIVE_WORDS,
    MAX_WORDS,
    MIN_WORDS,
    SFW_WORDS,
    STYLE_WORDS,
    TEXT_WORDS,
)


def _hits(text: str, terms: tuple[str, ...]) -> list[str]:
    """Whole-word (or whole-phrase) matches, case-insensitive.

    Word-boundary anchored on purpose: a substring scan flags "bloody" inside
    nothing useful but does flag "assemble" for a three-letter term, and a
    denylist that cries wolf gets deleted by the next person.
    """
    low = text.lower()
    found = []
    for t in terms:
        if re.search(rf"(?<!\w){re.escape(t)}(?!\w)", low):
            found.append(t)
    return found


def parse_output(raw: dict) -> dict[int, dict]:
    """Structured Outputs guarantees the shape; this keys it by scene id and trims.

    A duplicate id keeps the FIRST answer — an id answered twice is a model
    error, and picking the later one would silently discard the earlier scene.
    """
    out: dict[int, dict] = {}
    for s in raw.get("scenes") or []:
        sid = s.get("id")
        if not isinstance(sid, int) or sid in out:
            continue
        out[sid] = {
            "id": sid,
            "visual_context": (s.get("visual_context") or "").strip(),
            "negative_prompt": (s.get("negative_prompt") or "").strip(),
        }
    return out


def validate(answers: dict[int, dict], requested_ids: list[int]) -> tuple[list[int], list[str]]:
    """Check every requested scene.

    Returns (valid_ids, problems). Valid ids are banked by the caller and never
    re-requested, so a good scene cannot be corrupted by another scene's retry.
    """
    problems: list[str] = []
    valid: list[int] = []

    for sid in requested_ids:
        a = answers.get(sid)
        if a is None:
            problems.append(f"Scene {sid} is missing from your answer. Every scene id must be answered.")
            continue

        vc = a["visual_context"]
        neg = a["negative_prompt"]
        faults: list[str] = []

        n = len(vc.split())
        if n < MIN_WORDS:
            faults.append(f"visual_context is {n} words; write at least {MIN_WORDS} (subject, setting, lighting, colour)")
        elif n > MAX_WORDS:
            faults.append(f"visual_context is {n} words; cut to at most {MAX_WORDS}")

        style = _hits(vc, STYLE_WORDS)
        if style:
            faults.append(
                f"visual_context names a style/medium/camera word ({', '.join(style)}); "
                "the art style is added automatically — describe only what is in the scene"
            )

        text_hits = _hits(vc, TEXT_WORDS)
        if text_hits:
            faults.append(
                f"visual_context asks for text in the image ({', '.join(text_hits)}); "
                "generated text is always garbled and is never wanted"
            )

        sfw = _hits(vc, SFW_WORDS)
        if sfw:
            faults.append(
                f"visual_context contains banned imagery ({', '.join(sfw)}). This is "
                "YouTube. Depict the moment tastefully and bloodlessly instead — a "
                "distant silhouette, an empty landscape, a symbolic object, an "
                "aftermath with nothing graphic in frame"
            )

        if not neg:
            faults.append("negative_prompt is empty; list what must not appear in THIS scene")
        elif len(neg.split()) > MAX_NEGATIVE_WORDS:
            faults.append(f"negative_prompt is {len(neg.split())} words; cut to at most {MAX_NEGATIVE_WORDS}")

        if faults:
            problems.append(f"Scene {sid}: " + "; ".join(faults) + ".")
        else:
            valid.append(sid)

    extra = [sid for sid in answers if sid not in set(requested_ids)]
    if extra:
        problems.append(
            f"You answered scene ids that were not requested ({extra}). Answer exactly "
            "the ids you were given."
        )

    return valid, problems
