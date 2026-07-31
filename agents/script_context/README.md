# `script_context`

Reads the whole script once and produces the grounding every later scene
inherits. Runs **once per job**.

Replaces `GLOBAL_CONTEXT_PROMPT` in `lib/scene-engine/sleep-scene-prompt.ts`.

## I/O

```
echo '{"script":"...","genre":"space"}' | python3 -m script_context
```

**In**

| Field | Type | Notes |
|---|---|---|
| `script` | string | required. Empty string returns an empty result before any model call |
| `genre` | string | **optional override.** Omit it — inference is the normal path |

**Out**

| Field | Type | Notes |
|---|---|---|
| `genre` | string | **inferred from the script** unless the payload pinned it |
| `summary` | string | topic, tone, setting. Prepended to every downstream prompt |
| `grounding` | string | the physical constraints imagery must respect |
| `recurring_subjects` | string[] | things that must look the same in every scene |
| `overlay_pack` | string | derived from genre — the filename prefix in `public/overlays` |

## Genre is inferred, not configured

The whole point: a new kind of video should not need a code change or a Baserow
column to look right. Classification and grounding happen in ONE call, because
the grounding *is* the classification worked out in detail — splitting them
would mean a second round trip whose only input is the first one's label.

Structured Outputs constrains `genre` to the enum, so an invented genre is
impossible. Passing `genre` in the payload pins it and drops the classification
task from the prompt entirely (leaving the field in would invite the model to
argue with an override that exists to overrule it).

Measured on four real scripts, no genre supplied:

| script | → | correct? |
|---|---|---|
| Cassini's final orbit | `space` | ✅ |
| Somme stretcher bearers | `history` | ✅ |
| guided body-scan meditation | `abstract` (empty grounding) | ✅ |
| WWI shell burst "like a supernova" | `history` | ✅ — the trap case |

## `overlay_pack` is derived, not decided

There is no agent for overlay selection. Clips in `public/overlays` are prefixed
by pack (`fire-*`, `space-*`) and `render-modal/modal_app.py` lists
`<pack>-*.mp4` at render time, so "which overlays suit this video" collapses into
"what is this video about" — which this agent already answers. The map lives in
`shared/genres.py` `OVERLAY_PACK`. A model call there would add a failure mode
and decide nothing extra.

## Why `grounding` is one free-text field

Not `{era, place, technology}`. The *content* is genre-shaped; the *slot* is not.
A structured field would need a new key per genre, and that is how genre
knowledge leaks back into app code. See `agents/CLAUDE.md`.

## Checks

- `summary` within `[SUMMARY_MIN_WORDS, SUMMARY_MAX_WORDS]` — it is paid once per
  chunk downstream, so length here multiplies
- `grounding` under `GROUNDING_MAX_WORDS`, and **non-empty unless the genre is in
  `genres.UNGROUNDED`** (only `abstract`). An empty grounding on a grounded genre
  means every downstream scene is unanchored
- `recurring_subjects` deduped case-insensitively and capped at
  `MAX_RECURRING_SUBJECTS`

## Tests

`python3 agents/script_context/test_script_context.py` — offline, no key.
