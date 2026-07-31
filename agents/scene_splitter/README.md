# `scene_splitter`

Splits one chunk of narration into the exact stretches of text each scene covers.
**Genre-blind** — it decides where a scene starts and stops, never what it looks
like. Runs once per chunk (`ceil(sentences / 40)` times per job).

Ported from `healSnippet` + `closeCoverageGaps` in
`lib/scene-engine/no-gap-breakdown.ts`.

## I/O

```
echo '{"chunk_text":"...","context":{"summary":"..."}}' | python3 -m scene_splitter
```

**In**

| Field | Type | Notes |
|---|---|---|
| `chunk_text` | string | required. Blank returns `{"snippets": []}` before any model call |
| `context` | object | optional. Only `summary` is used — never `grounding` |
| `target_seconds` | number | optional, defaults to `TARGET_SECONDS` (20) |

**Out**: `{"snippets": [str, ...]}` — **concatenating them in order reproduces
`chunk_text` character-for-character.** That is the contract; everything else
here exists to guarantee it.

## Why only `summary` reaches the prompt

`grounding` is imagery guidance. Handing it to an agent whose job is text
boundaries invites visual thinking into a decision that has nothing to do with
visuals.

## Checks

- every snippet is an exact substring of `chunk_text`
- `"".join(snippets) == chunk_text` — the load-bearing one. Audio alignment
  depends on it; a single altered character desynchronises the rest of the video
- a whitespace-only mismatch is reported as its own distinct problem, because the
  fix ("preserve the spacing") is different from the fix for missing text
- scene count within `COUNT_TOLERANCE` of `chunk_words / (target × wps)`, which
  catches the real failure mode: one scene per sentence

## Deliberate deviation from the TypeScript

The TS `closeCoverageGaps` located snippets with `chunkText.indexOf(snippet)` —
always from position 0. On repeated text (and sleep narration repeats phrases on
purpose) the second occurrence resolved to the first and the computed gaps were
nonsense. This port searches from a running cursor, so occurrence N resolves to
occurrence N. Covered by
`test_close_gaps_repeated_phrase_resolves_each_occurrence`.

## Gap closing is a repair, not a coercion

An uncovered run of text has exactly one correct home — the scene it follows, or
the first scene for a leading gap. Nothing is guessed. It runs before validation
on every attempt, and validation still has to pass afterwards.

## Tests

`python3 agents/scene_splitter/test_scene_splitter.py` — offline, no key.
