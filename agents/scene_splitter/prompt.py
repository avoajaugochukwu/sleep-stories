"""Prompt for scene_splitter.

Genre-blind on purpose. This agent decides WHERE a scene starts and stops;
nothing about what it looks like. The context is supplied only so it can tell
when the narration has moved to a different subject — never so it can describe
one.
"""

from __future__ import annotations

_SYSTEM = """You split a chunk of narration into scenes. You do not describe \
images, name subjects, or write any visual language — another agent does that. \
Your only output is the exact stretches of text each scene covers.

## LONG, SLOW SCENES

These are long-form, slow-paced sleep narration videos. Scenes are unhurried — \
about {target} seconds each when read aloud (roughly {words} words; several \
sentences).

- Group consecutive sentences that share a subject or a moment into ONE scene.
- NEVER use rapid cuts, staccato bursts, or one-scene-per-list-item splitting. \
That is the opposite of what this content needs.
- Only start a new scene when the narration clearly moves to a different thing.
- Prefer slightly longer scenes over more, shorter ones.
- Never split a single sentence across two scenes. Each snippet is one or more \
COMPLETE sentences.

## VERBATIM MANDATE

Each snippet MUST be copied CHARACTER-FOR-CHARACTER from the input chunk.

- Do NOT paraphrase, reword, summarize, reorder, or "fix" anything.
- Do NOT add or remove words, punctuation, or whitespace.
- Preserve the original spacing and line breaks exactly.
- Concatenating your snippets in order, with nothing between them, must \
reproduce the input chunk EXACTLY — every character, no gaps, no overlaps.

This is not a style rule. The finished video aligns narration audio against these \
snippets; a single altered character desynchronises the audio for the rest of the \
video."""


def build_prompt(
    chunk_text: str,
    context: dict,
    target_seconds: float,
    words_per_scene: int,
    feedback: str = "",
) -> list[dict]:
    system = _SYSTEM.format(target=round(target_seconds), words=words_per_scene)

    # Summary only — never `grounding`. Grounding is imagery guidance, and this
    # agent must not be tempted into visual thinking.
    summary = (context or {}).get("summary", "").strip()
    preamble = (
        f"Context for this video (use it only to recognise when the subject "
        f"changes):\n{summary}\n\n"
        if summary
        else ""
    )
    user = f'{preamble}Split this chunk:\n\n"""\n{chunk_text}\n"""'
    if feedback:
        user += f"\n\n## Fix Required\n{feedback}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
