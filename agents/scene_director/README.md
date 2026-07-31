# `scene_director`

Turns scene snippets into image prompts. Runs once per chunk.

**This is the genre-swappable agent.** Military-history direction and cosmos
direction are two blocks in `prompt.py`, not two code paths. Adding a genre
touches this agent and `shared/genres.py` — and no TypeScript at all.

## I/O

```
echo '{"context":{...},"genre":"space","scenes":[{"id":1,"snippet":"..."}]}' \
  | python3 -m scene_director
```

**In**

| Field | Type | Notes |
|---|---|---|
| `scenes` | `[{id:int, snippet:str}]` | required. Empty returns `{"scenes": []}` before any model call |
| `context` | object | optional. `summary`, `grounding`, `recurring_subjects`, `genre` |
| `genre` | string | optional override; otherwise taken from `context.genre` |

**Out**: `{"scenes": [{id, visual_context, negative_prompt}]}` in input order.

`visual_context` maps to `Scene.visual_prompt`; `negative_prompt` maps straight
across. Wire names match what `lib/scene-engine` already uses, so the TS side
does not churn.

## Adding a genre

1. name it in `shared/genres.py` `GENRES`
2. add its block to `prompt.py` `GENRE_BRIEFS`
3. add its constant negatives to `prompt.py` `GENRE_NEGATIVES`

`test_every_genre_has_a_brief_and_negatives` fails if you do 1 without 2 or 3 —
otherwise a registered genre would silently fall back to history direction.

`GENRE_NEGATIVES` is appended to every scene's negative prompt in code, not asked
for from the model: it is constant per genre, so spending tokens and a possible
retry round on the model remembering it would be waste.

## Checks

- one answer per requested id, no extras, no omissions
- `visual_context` within `[MIN_WORDS, MAX_WORDS]`
- **no style/medium/camera/lens words** — `lib/jobs/scene-image.ts` prepends
  `STYLE_PREFIX`, and a second style declaration fights it
- no request for text/captions/watermarks in the image
- **SFW denylist** — see below
- `negative_prompt` non-empty and under `MAX_NEGATIVE_WORDS`

Denylists are whole-word anchored. A denylist that cries wolf gets deleted by the
next person.

## Banking

Validation is per scene id. A chunk can carry 20 scenes, and one bad word in one
of them must not force the other 19 to be rewritten — possibly worse. Valid
scenes are banked and never re-requested; only failures go into the next round,
with a Fix Required block naming them.

## On the SFW check — do not oversell it

The old prompt carried an `SFW MANDATE (ABSOLUTE)` block in prose. Prose is not
absolute; it is a suggestion the model weighs against everything else you asked
for. Moving it into `checks.py` makes it a clamp.

But it is **a term denylist, not semantic safety.** It reliably catches the model
writing "blood" or "corpse". It cannot catch a tastefully-worded sentence
describing something that should not be drawn.

The real backstop is unchanged and lives elsewhere: `SFW_NEGATIVE` inside
`BASE_NEGATIVE` in `lib/jobs/scene-image.ts`, applied to every image regardless of
what any agent emitted. Two independent gates. Neither is trusted alone, and
neither should be removed because the other exists.

## Tests

`python3 agents/scene_director/test_scene_director.py` — offline, no key.
