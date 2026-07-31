# Plan — Python agent layer

Status: **all three agents built and live-tested. NOT wired into the pipeline.**
The running app is unchanged — `lib/scene-engine/script-to-scenes.ts` still
drives production, and nothing imports `lib/agents/bridge.ts` yet.

| Piece | State |
|---|---|
| `agents/shared/{llm,config,genres}.py` | done — imports with no SDK, no key |
| `agents/CLAUDE.md` | done |
| `agents/script_context/` | done — 11 checks, live: 5 recurring subjects, attempt 1 |
| `agents/scene_splitter/` | done — 15 checks, live: byte-exact, attempt 1 |
| `agents/scene_director/` | done — 16 checks, live: both genres, attempt 1–2 |
| `lib/agents/bridge.ts` | done — typed wrapper per agent |
| `app/api/agents/health/route.ts` | done, all 3 registered |
| **Dockerfile + build gate** | **NOT done — see Risks** |

Run them: `npm run check:agents` (42 checks, offline, no key).

## Genre is inferred now — and the overlay agent was deleted before it existed

Two decisions reversed from the original spec below, both for the better:

**1. `script_context` classifies the script instead of being told.** The spec
recommended an explicit `genre` on the ingest payload, arguing a silent misread
corrupts a whole video. Overruled deliberately: hardcoding a genre per board
means every new kind of video needs a code change or a Baserow column. The
payload field survives as an *override*. Measured on four real scripts with no
genre supplied — Cassini → `space`, Somme → `history`, a body-scan meditation →
`abstract` with correctly empty grounding, and the trap case (a WWI script
describing a shell burst "like a supernova") → `history`. 4/4.

**2. There is no overlay agent, and there should not be one.** The original plan
had an `atmosphere_director` picking clips from a tagged manifest. Prefixing the
clips by pack (`fire-*`, `space-*`) collapsed the whole problem: `modal_app.py`
lists `<pack>-*.mp4` at render time, so "which overlays" is `OVERLAY_PACK[genre]`
— a dict in `shared/genres.py`. A model call would add a failure mode and decide
nothing. The tagged-manifest JSON I had already written was deleted.

The lesson worth keeping: **the naming convention did more than the agent would
have.** Check whether a decision can be made structural before making it
probabilistic.

## Live findings from building it

- **Gap closing had to get stricter than the TypeScript it came from.** The TS
  `closeCoverageGaps` guarded every gap with `if (gap.trim())`, so a
  whitespace-only gap was skipped. Harmless there — the TS never required the
  snippets to concatenate back. Here byte-exact reassembly IS the contract, and
  the model drops the space between sentences on essentially every call. The
  first live run burned all 4 attempts on "missing 2 characters". Now every gap
  is absorbed, whitespace included.
- **The `indexOf`-from-zero bug came along for free and is now fixed.** The TS
  located each snippet from position 0, so on repeated narration ("the night was
  still." twice in a chunk) the second occurrence resolved to the first and the
  computed gaps were nonsense. The port uses a running cursor.
  `test_close_gaps_repeated_phrase_resolves_each_occurrence` pins it.
- **The SFW clamp fires and the repair loop fixes it.** On the stretcher-bearer
  chunk the director banked 1 of 2 scenes on attempt 1 and passed on attempt 2;
  the surviving prompt describes "a wool blanket drawn completely over the shape
  so no injuries are visible". That is the behaviour the old prose mandate was
  supposed to produce and could not guarantee.
- **The genre seam holds.** Same three agents, same code path. A Cassini script
  produced grounding about G-type sunlight, ring-reflected gold, hard shadow
  terminators and steady (non-twinkling) stars. A Somme script produced "Western
  Front trench warfare, circa 1916 … duckboards over saturated clay". No branch
  anywhere in `lib/`.
- **Constant negatives arrive twice unless deduped.** The prompt asks the model
  for the genre's clichés, so it writes them, and then `GENRE_NEGATIVES` appended
  them again — the first live output ended
  `"cartoon planets, lens flare starbursts, …, cartoon planets, lens flare starburst"`.
  Deduped case-insensitively on exact terms. The singular/plural near-miss in
  that very example still slips through; a stemmer is not worth writing for a
  negative prompt where a duplicate is merely untidy.

Contract, folder shape and doctrine are copied from
`../../../video-agents/military/agents/CLAUDE.md`. Read that first — it is the
authority, this file only says what is different here. The short version:

- stdout is the wire (result JSON only; every log to stderr), exit nonzero on failure
- the LLM judges, `checks.py` enforces — never move a cap or a ban into a prompt
- one job per agent
- validate → repair (bounded, 3 attempts) → raise. Never coerce
- bank the good: resend only the items that failed
- empty input returns before any model call (this is what keeps the build gate free)
- effort `low`, no exceptions without a measured reason

## Folder

```
agents/
  CLAUDE.md              # copied from military, edited for this app
  requirements.txt       # openai. nothing else
  shared/{llm,config}.py # copied, unmodified
  script_context/
  scene_splitter/
  scene_director/
lib/agents/bridge.ts     # copied from military
app/api/agents/health/route.ts
```

Each agent: `__main__.py` (stdin→stdout JSON), `prompt.py`, `schema.py`,
`checks.py`, `client.py`, `test_<name>.py` (offline, plain asserts), `README.md`
(the I/O contract), `config.py` (effort + overrides).

---

## Three agents

Deliberately three, not five. Two pieces of the current prompt are **not**
becoming agents — see "Stays in TypeScript" below.

### 1. `script_context` — grounding, once per job

Replaces `GLOBAL_CONTEXT_PROMPT` in `sleep-scene-prompt.ts`.

The existing prompt orders the model to pin an exact year ("France, 1916"). That
is a military-history assumption baked into the one call that is supposed to
discover what the script *is*. For a cosmos script it invents a period and then
every downstream scene inherits it.

**In:** `{ "script": str, "genre": str }` — genre supplied by the caller
(see "Where genre comes from"), the agent does not guess it.

**Out:**
```json
{
  "summary": "3-4 sentences: topic, tone, setting",
  "grounding": "the era/place/technology constraints, OR the physical scale and
                light sources for a cosmic subject, OR empty for abstract",
  "recurring_subjects": ["named things that must look the same in every scene"]
}
```

`grounding` is deliberately one free-text field, not `{era, place, technology}`.
Its *content* is genre-shaped; its *slot* is not. That is what stops a second
genre from adding a branch.

**checks.py:** summary non-empty and under a word cap; `recurring_subjects`
capped (~12) so it cannot balloon the per-chunk prompt; `grounding` non-empty
unless the genre declares itself abstract.

### 2. `scene_splitter` — narration → snippets. Genre-blind.

**In:** `{ "chunk_text": str, "context": {summary, grounding}, "target_seconds": 20 }`

**Out:** `{ "snippets": ["...", "..."] }` — nothing else. No visuals.

This agent's goal is mechanical, so it is where the guarantees live. Port
`healSnippet` and `closeCoverageGaps` from `script-to-scenes.ts` into
`checks.py`: they are already the right logic on the right side of the line,
just written in the wrong language and entangled with the creative prompt.

**checks.py owns:**
- every snippet is a char-for-char substring of `chunk_text`
- snippets are contiguous, in order, no gaps, no overlaps, covering 100% of the chunk
- no snippet splits a sentence
- scene count within a band derived from chunk word count (a 40-sentence chunk
  cannot legitimately yield 2 scenes or 60)

Coverage failures feed a `## Fix Required` block naming the offending snippet and
the exact gap text. Repair, do not coerce — **except** where `closeCoverageGaps`
already deterministically reassigns a gap to a neighbour, which is a correct
repair, not a coercion, and stays.

⚠️ **Highest regression risk in the repo.** Audio alignment depends on snippets
reconstructing the script exactly. Build last of the three, A/B on a real
2-hour script, and diff the reassembled script against the input byte-for-byte
before wiring.

### 3. `scene_director` — snippets → imagery. The genre-swappable one.

**In:** `{ "context": {...}, "genre": str, "scenes": [{ "id": int, "snippet": str }] }`

**Out:**
```json
{ "scenes": [ { "id": 1, "visual_context": "...", "negative_prompt": "..." } ] }
```

Keys the wire names already used (`visual_context` → `Scene.visual_prompt`,
`negative_prompt`) so the TS side does not churn.

**This is the entire genre surface.** `prompt.py` holds a base brief (single
clear subject, named lighting, vivid saturated colour, no art-style/camera
words, word count) plus one genre block selected by the `genre` input:

- `history` — the existing era/place/technology lock and per-scene anachronism
  negatives, lifted verbatim from `sleep-scene-prompt.ts`
- `space` — physical scale, real light sources (star colour by type, albedo,
  no sound, no atmospheric haze in vacuum), and its own negatives: cartoon
  planets, lens flare starbursts, wrong-colour nebulae, Earth-like gravity cues

Adding a third genre = a third block. **No app code changes.** That is the
whole reason for this refactor.

**checks.py owns:**
- one output per input id, no extras, no omissions (bank the good; resend only
  failed ids)
- word count band on `visual_context`
- no art-style/medium/camera/lens words (denylist — `STYLE_PREFIX` is prepended
  by `lib/jobs/scene-image.ts`, so a style word here fights it)
- no text/caption/watermark/logo references
- `negative_prompt` present and under a word cap
- **the SFW ban, moved out of the prompt.** Today it is prose marked `ABSOLUTE`
  in `sleep-scene-prompt.ts`. Prose is not absolute. It becomes a denylist check
  on the emitted `visual_context`.
  Be honest about what this is: a **term denylist, not semantic safety.** It
  catches the model writing "blood" or "corpse"; it cannot catch a tasteful
  sentence describing something it shouldn't. The real backstop stays where it
  is — `SFW_NEGATIVE` inside `BASE_NEGATIVE` (`lib/jobs/scene-image.ts:31`),
  applied to every image regardless of what any agent emitted. Two independent
  gates, neither trusted alone.

---

## Stays in TypeScript

Not everything that calls a model deserves an agent.

- **`lib/scene-engine/script-splitter.ts`** — chunking at 40 sentences is
  deterministic and involves no judgement. It already is the code half.
- **`lib/scene-engine/story-text.ts`** (title) — one call per job, and it has a
  legitimate heuristic fallback so a render is never blocked on the model.
  Military doctrine says an agent failing **fails the job**; converting this
  would force a throw where a fallback is correct. Leave it.

---

## Where genre comes from

**Recommendation: explicit, from the ingest payload.** `POST /api/jobs/ingest`
gains an optional `genre` (default `history`), stored on the `sleep_jobs` row and
threaded to both agents. `script_context` may enrich the grounding but never
overrides the declared genre.

Inference is the tempting option and the wrong default: a misread genre is
silent, and it corrupts every scene of a multi-hour video before anyone sees a
frame. An explicit field is one more thing for the Baserow automation to set and
zero things that can be quietly wrong.

Board mapping in `lib/jobs/config.ts` (`BOARDS`) was the alternative source, and
it is now ruled out: **there is no space ClickUp list.** Enumerated 2026-07-31 —
the only sleep-stories board is `901113872792`, which ClickUp names **Midnight
Mysteries** (the code had it labelled "Sleep Stories"). The tempting-looking
`901113798933 "Space Cluster"` is footage-collector's WW2 board despite the name
— its tasks are `[Attch] Hitler's Tank Designer…` in `fc done`.

So the payload-genre design is not just the safer option, it is the only one that
needs no new ClickUp setup: space rides the existing Midnight Mysteries list with
`genre: "space"` on the ingest body.

---

## Build order

Ordered so the thing that unblocks space lands first, and nothing is wired in
unproven (military: *"Prove before wiring"*).

| # | Step | Gate before wiring | State |
|---|---|---|---|
| 1 | Infra: `shared/`, `bridge.ts`, health route | `npm run check:agents` green with no API key | ✅ 42 checks |
| 1b | Dockerfile + build gate | container serves Next AND runs `python3 -m <agent>` | ⚠️ written, **image never built** (no local docker daemon) |
| 2 | `scene_director` | A/B vs current output on a real script; images visibly no worse | ⚠️ built + smoke-tested, **A/B not run** |
| 3 | `space` genre block | 10 scenes generated and eyeballed | ⚠️ built, 4 scenes eyeballed |
| 4 | `script_context` | grounding correct on one history + one space script | ✅ both verified live |
| 5 | `scene_splitter` | reassembled script matches byte-for-byte on a 2h job | ⚠️ byte-exact on a 305-char chunk only |

Steps 2 and 3 ship value on their own — a space video is possible after step 3
even if 5 never lands. Step 5 is the one that can break existing videos, and its
gate has NOT been met: one short chunk is not a 2-hour script.

### What "not wired" means concretely

Nothing imports `lib/agents/bridge.ts`. To actually use these,
`lib/scene-engine/script-to-scenes.ts` has to call the agents instead of its own
two `openai.chat.completions.create` calls, and `lib/jobs/worker.ts` has to pass a
genre through. Neither change is made. Do them one at a time, behind the gates
above.

## Cost

Splitter + director is **2 model calls per chunk instead of 1**, plus military's
measured ~11.4k tokens of agent preamble per call. At current volumes (~5 calls
per job, against 176 image generations) this is noise — image spend dominates by
orders of magnitude. It stops being noise if the director ever goes per-scene.
**Keep it per-chunk.**

Do **not** port military's codex-subscription routing on reflex. It pays for
itself there because `identify` makes ~174 vision calls per job. There is no
equivalent call volume here.

## Risks

- **Dockerfile switches Railway off Nixpacks.** This app's ingest worker is a
  long-lived process (`lib/jobs/worker.ts` drain loop). Verify the drain loop and
  `ensureResumed()` survive the container change before step 1 is called done.
- **Python in the web image.** `agents/requirements.txt` installs into the same
  container that serves Next. Keep it to `openai`.
- **Two prompts where there was one.** The current single prompt is coherent
  partly *because* the model sees narration and picks the visual in one pass.
  Splitting is correct by doctrine but it is a real change in what the model
  sees — step 2's A/B is not a formality.
