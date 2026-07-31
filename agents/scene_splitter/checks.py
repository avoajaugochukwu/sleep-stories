"""Deterministic rules for scene_splitter — the whole point of this agent.

Ported from `healSnippet` and `closeCoverageGaps` in
lib/scene-engine/no-gap-breakdown.ts. That logic was already on the correct side
of the LLM-judges/code-enforces line; it was just written in the same file as the
creative prompt, so nobody could touch one without risking the other.

Nothing here calls a model, and this module must import without the openai SDK.

**One deliberate deviation from the TypeScript.** The TS `closeCoverageGaps`
locates each snippet with `chunkText.indexOf(snippet)` — always from position 0.
On a script that repeats a phrase (and sleep-story narration repeats phrases on
purpose) the second occurrence resolves to the first, and the computed gaps are
then nonsense. This port searches from a running cursor instead, so occurrence N
resolves to occurrence N. Same amount of code, correct on repeated text.
"""

from __future__ import annotations

import re

from .schema import COUNT_TOLERANCE, MIN_SCENES, TARGET_SECONDS, WORDS_PER_SECOND

_WS = re.compile(r"\s+")


def _collapse(text: str) -> str:
    return _WS.sub(" ", text)


def heal_snippet(snippet: str, chunk_text: str) -> str:
    """Return `snippet` as an exact substring of `chunk_text` where possible.

    If the model echoed the text verbatim we keep it. Otherwise we try a
    whitespace-insensitive match and recover the precise slice, so gap closing
    downstream has something to anchor to. An unanchorable snippet is returned
    unchanged and fails validation loudly rather than being guessed at.
    """
    if snippet in chunk_text:
        return snippet

    collapsed_chunk = _collapse(chunk_text)
    collapsed_snippet = _collapse(snippet).strip()
    if not collapsed_snippet:
        return snippet
    idx = collapsed_chunk.find(collapsed_snippet)
    if idx == -1:
        return snippet  # unanchored — validation will catch it

    # Map the collapsed index back onto the real text by walking it.
    real_start = 0
    seen = 0
    i = 0
    while i < len(chunk_text) and seen < idx:
        if chunk_text[i].isspace():
            # a run of whitespace collapses to one counted space
            if i == 0 or not chunk_text[i - 1].isspace():
                seen += 1
        else:
            seen += 1
        real_start = i + 1
        i += 1

    if not _collapse(chunk_text[real_start:]).startswith(collapsed_snippet):
        return snippet

    end = real_start
    consumed = 0
    while end < len(chunk_text) and consumed < len(collapsed_snippet):
        if chunk_text[end].isspace():
            if end == real_start or not chunk_text[end - 1].isspace():
                consumed += 1
        else:
            consumed += 1
        end += 1

    sliced = chunk_text[real_start:end]
    return sliced if sliced.strip() else snippet


def close_coverage_gaps(snippets: list[str], chunk_text: str) -> list[str]:
    """Absorb any leading / inter-scene / trailing gap into a neighbouring snippet.

    This is a repair, not a coercion: an uncovered run of text has exactly one
    correct home (the scene it follows, or the first scene for a leading gap), so
    there is nothing being guessed. It is what makes byte-exact coverage
    achievable at all — see agents/CLAUDE.md.

    **Whitespace-only gaps are absorbed too.** The TS original guarded every gap
    with `if (gap.trim())`, which was fine there because it never required the
    snippets to concatenate back — a dropped inter-sentence space was harmless.
    Here byte-exact reassembly IS the contract, so every character counts. The
    model drops the space between sentences on essentially every call; skipping
    those gaps made the contract unreachable and burned all 4 attempts on a live
    run before this was fixed.

    Returns a new list; does not mutate the input.
    """
    if not snippets:
        return []

    out = list(snippets)

    # Locate each snippet from a running cursor so a repeated phrase resolves to
    # its own occurrence rather than the first one in the chunk.
    spans: list[tuple[int, int]] = []
    cursor = 0
    for s in out:
        start = chunk_text.find(s, cursor) if s else -1
        if start == -1:
            spans.append((-1, -1))
            continue
        spans.append((start, start + len(s)))
        cursor = start + len(s)

    # Leading gap
    first_start = spans[0][0]
    if first_start > 0:
        out[0] = chunk_text[:first_start] + out[0]
        spans[0] = (0, len(out[0]))

    # Gaps between adjacent scenes
    for i in range(len(out) - 1):
        end = spans[i][1]
        nxt = spans[i + 1][0]
        if end == -1 or nxt == -1:
            continue
        if nxt > end:
            out[i] += chunk_text[end:nxt]
            spans[i] = (spans[i][0], nxt)

    # Trailing gap
    last_end = spans[-1][1]
    if last_end != -1 and last_end < len(chunk_text):
        out[-1] += chunk_text[last_end:]

    return out


def expected_scene_count(chunk_text: str, target_seconds: float = TARGET_SECONDS) -> float:
    words = len(chunk_text.split())
    per_scene = target_seconds * WORDS_PER_SECOND
    return max(1.0, words / per_scene) if per_scene else 1.0


def validate(snippets: list[str], chunk_text: str, target_seconds: float = TARGET_SECONDS) -> list[str]:
    """Return a list of problems. Empty means valid.

    Each string names what is wrong and states the fix, because these go verbatim
    into the repair prompt — "invalid snippet" is useless there.
    """
    problems: list[str] = []

    if not snippets:
        problems.append(
            "You returned no snippets. Every chunk must be split into at least one scene."
        )
        return problems

    for i, s in enumerate(snippets):
        if not s.strip():
            problems.append(f"Snippet {i + 1} is empty. Remove it or give it real text.")
        elif s not in chunk_text:
            problems.append(
                f"Snippet {i + 1} is not a character-for-character substring of the "
                f"chunk. Copy the text exactly — do not paraphrase, reword, or fix "
                f"punctuation. It began: {s[:60]!r}"
            )

    # The load-bearing check. Everything above is diagnosis; this is the contract:
    # audio alignment depends on the snippets reassembling into the exact input.
    rebuilt = "".join(snippets)
    if rebuilt != chunk_text:
        if _collapse(rebuilt).strip() == _collapse(chunk_text).strip():
            problems.append(
                "The snippets differ from the chunk only in whitespace. Preserve the "
                "original spacing and line breaks exactly."
            )
        else:
            missing = len(chunk_text) - len(rebuilt)
            problems.append(
                "Concatenating your snippets in order does not reproduce the chunk "
                f"({'missing' if missing > 0 else 'extra'} {abs(missing)} characters). "
                "Every character of the input must appear in exactly one snippet, in "
                "order, with no gaps and no overlaps."
            )

    if len(snippets) < MIN_SCENES:
        problems.append(f"Return at least {MIN_SCENES} scene.")

    expected = expected_scene_count(chunk_text, target_seconds)
    if len(snippets) > expected * COUNT_TOLERANCE:
        problems.append(
            f"You returned {len(snippets)} scenes for a chunk that should hold about "
            f"{expected:.0f}. These are slow, unhurried videos — group consecutive "
            f"sentences that share a subject into ONE scene of roughly "
            f"{target_seconds:.0f} seconds. Never one scene per sentence."
        )
    elif len(snippets) * COUNT_TOLERANCE < expected:
        problems.append(
            f"You returned {len(snippets)} scenes for a chunk that should hold about "
            f"{expected:.0f}. Split where the narration moves to a different subject."
        )

    return problems
