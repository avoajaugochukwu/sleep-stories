# Handoff — 2026-07-31

Read this first, then `CLAUDE.md` (architecture) and `agents/CLAUDE.md` (rules
for the Python layer). `session.md` is the running log; `docs/CHANGELOG.md` is
the dated history.

---

## State in one paragraph

The app lands on a job queue instead of the scene editor; jobs have their own
URLs and honestly report whether a video is rendering or rendered. It builds and
deploys via **Docker, not Nixpacks** (hard requirement — the user said so
twice). The scene pipeline is a deterministic cut plus two Python agents, and
the TypeScript path it replaced is deleted. Overlay clips are prefixed by pack
(`fire-*`, `space-*`) and `overlayPack` is threaded end to end. **Modal is
redeployed with the renamed clips.** Railway has not been pushed since the scene
rework, so that is the one thing standing between here and a live test.

---

## Deployed vs local

| | state |
|---|---|
| **Modal** (`sleep-render`) | ✅ redeployed 2026-07-31 with the `fire-`/`space-` clips baked in. `https://avoajaugochukwu--sleep-render-web.modal.run` |
| **Railway** (`sleep-stories`) | ⚠️ **stale.** Last push predates the whole scene rework — it still has `no-gap-breakdown.ts` and no `overlayPack`. |

```bash
railway up --service sleep-stories

# then:
curl -s https://sleep-stories.up.railway.app/api/agents/health | python3 -m json.tool
# expect runtime.ok true, python 3.11.2, script_context + scene_director importable
```

⚠️ **The Docker image has never been built locally** (no docker daemon here).
The build gate's shell commands were verified by hand. The first `railway up`
after the rework is the real test of it.

---

## The scene path

Contract copied from `../../../video-agents/military/agents/CLAUDE.md`: JSON on
stdin, JSON on stdout, logs on stderr, exit nonzero on failure. Read
`agents/CLAUDE.md` before editing anything under `agents/`.

| step | job | checks |
|---|---|---|
| `lib/scene-engine/cut-script.ts` | script → snippets. **No model.** `compromise` for sentence bounds, a cut every 5 sentences, every snippet a slice of the original | 14 |
| `script_context` | whole-script grounding **+ genre classification** | 15, live 4/4 |
| `scene_director` | snippets → `visual_context` + `negative_prompt`, batched 8 at a time | 17, both genres live |

```bash
npm run check:agents    # 32 offline checks, no API key, no network
npm run check:cut       # 14, runs the TS directly via --experimental-strip-types
```

`lib/scene-engine/script-to-scenes.ts` is 75 lines of orchestration — no prompt,
no LLM call, no chunking of its own. `lib/agents/bridge.ts` spawns the agents;
`app/api/agents/health/route.ts` invokes each on an empty payload, which is why
it is free and keyless — **do not break the empty-input early return**, the
Docker build gate depends on it too.

**`scene_splitter` was deleted.** It went through three designs in a day and the
third was to delete it; the reasoning is in "Better than validating" in
`agents/CLAUDE.md` and is worth reading before anyone rebuilds one. Short
version: nothing downstream cares *where* a scene starts, only that the scenes
tile the script.

### Genre is inferred, not configured

`script_context` classifies the script and returns `genre` + `overlay_pack`.
Payload `genre` is an **override**, not the normal path. Measured live with
nothing supplied: Cassini → `space`, Somme → `history`, body-scan meditation →
`abstract` (correctly empty grounding), and a WWI script saying "burst like a
supernova" → `history` (the trap case). 4/4.

### There is no overlay agent, on purpose

Clips are prefixed by pack. `modal_app.py` lists `<pack>-*.mp4` and ffprobes
durations at render time, so "which overlays" is `OVERLAY_PACK[genre]` — a dict
in `agents/shared/genres.py`. A tagged-manifest JSON + `atmosphere_director`
agent were written and then **deleted** once the prefix convention made them
pointless. Do not reintroduce them.

### The queue

- `lib/jobs/render-state.ts` — `deriveJobState()`, the ONE place that decides a
  job's state. Nine states, derived on read, never stored.
- `app/jobs/[taskId]/page.tsx` + `components/jobs/job-detail.tsx` — read-only,
  deliberately does **not** mount the session store.
- List route does not poll Modal (one call per row per poll); the job page does.

---

## Next steps

### 1. `railway up --service sleep-stories`

### 2. Run one real job and look at the images

No A/B was run before deleting the TS path, so the first job is the test.
Reassembly is not the thing to check — snippets are slices and `cutScript`
asserts the join. What is untested on real content is **image quality from
`scene_director`**, the one place output still comes from a model.

The completed Somme job is the reference for what the old path produced:

```bash
curl -s https://sleep-stories.up.railway.app/api/jobs/868kj78jw -o /tmp/somme.json
python3 -c "
import json; d=json.load(open('/tmp/somme.json'))
sb=d['projectJson']['state']['storyboardScenes']
print(len(sb),'scenes'); print(sb[0]['visual_prompt'][:200])"
```

Then grep the worker log for `SALVAGED` — the director having given up on a
scene and reused a neighbour's imagery. Rare is fine; common means the prompt or
the checks in `scene_director/checks.py` need attention.

### 3. Confirm the overlay pack actually switched

A space-genre job should composite `space-*` clips. If the render looks like
smoke over a starfield doc, `overlay_pool()` fell back — check the Modal logs
for the fallback warning.

---

## Facts worth not relearning

- **Always Docker, never Nixpacks.** User stated it twice, emphatically. Nixpacks
  injected runtime env vars into the build, which masked
  `export const openai = getOpenAIClient()` running at import — `next build`
  evaluates route modules and died on a missing `OPENAI_API_KEY`. Fixed with a
  lazy Proxy. **A build must never need a runtime secret.** Verify:
  move `.env.local` aside, `npm run build`, move it back.
- **`STYLE_PREFIX` was being applied twice on 44% of scenes** (77/176 in the live
  Somme job) because `worker.ts` stored `prompt_used` — the *final* prompt —
  back into `visual_prompt`, making it non-idempotent across retries. Fixed at
  source plus a `stripLeadingStyle()` repair for already-stored projects.
- **`compromise` is load-bearing.** A regex on `[.!?]\s` splits "Mr. Smith",
  "Dr. Reed", "the U.S. Army" and "$4.50" mid-sentence. It is used for boundary
  *offsets* only — its strings are normalized and must never become snippet
  text. Covered by `npm run check:cut`.
- **`closeCoverageGaps` and `healSnippet` are gone entirely**, along with the
  agent that replaced them. Both existed to repair scene text after a model had
  copied it out; `cut-script.ts` never lets a model near the text. Their bugs
  (`indexOf` from position 0, so repeated narration resolved to the first
  occurrence; whitespace-only gaps skipped) argue against ever reintroducing the
  shape.
- **ClickUp list `901113872792` is named "Midnight Mysteries"**, not "Sleep
  Stories". `901113798933 "Space Cluster"` is *footage-collector's* WW2 board
  despite the name. There is no space list; genre rides the payload/inference.
- **`fc done` was added to the board by the user** on 2026-07-31, so
  `STATUS_DONE` writeback works from the next job onward. It had silently
  no-opped forever before that.
- **Overlay clip sizes matter.** A 450MB 30 Mbps starfield went into *two* images
  (Railway + Modal). Denoised (the renderer adds its own grain via `GRAIN=9`,
  so source grain was paid for then overwritten), trimmed to 45s, re-encoded:
  **450MB → 61MB**, visually indistinguishable at the 0.16–0.28 opacity it
  renders at. Overlays total 148MB now, would have been ~575MB.
- **Modal probes clip durations at render time** rather than using constants.
  The old hardcoded pool had drifted (`red_faint_fire` listed 12.0, is
  12.031667) and that number is a modulo for the source seek — wrong value makes
  the clip jump.

---

## Open decisions

1. **Web search for grounding — unanswered.** User asked for it. My read: not yet
   earned. `script_context` already produces G2V sunlight, ring-reflected gold,
   hard shadow terminators, Brodie helmets and 1916 wool tunics with no search.
   Adding it means restoring the tool loop deliberately deleted from
   `shared/llm.py`, plus a Serper key. Recommendation: build without, add a
   narrow verification pass only on named claims that measurably come back wrong.
2. **`CHUNK_SIZE = 8` in `scene_director` is an unmeasured guess.** 12–16 would
   halve the calls. The risk is neighbouring scenes getting samey, since batch
   size decides how much surrounding narration one call sees. Worth measuring
   once there is a real job to look at.
3. **Two renders exist for the same Somme title** — `f2561e60723d` (07-29,
   624MB) and `8ef46d461488` (07-30, 634MB). Could be a legitimate re-run, could
   be the duplicate-render bug that is now fixed. Worth a look.
4. **`public/` is copied whole into the Docker image** (148MB of overlays the
   Next app never serves — `modal_app.py` reads them from the repo at
   Modal-deploy time). Deliberate: an exclusion would break silently the day a
   served asset lands under those paths. Revisit if image size bites.

---

## Verification commands

```bash
npx tsc --noEmit                 # must be clean
npm run build                    # must pass with .env.local moved aside
npm run check:agents             # 32 offline checks
npm run check:cut                # 14, the deterministic scene cut
cd agents && echo '{}' | python3 -m script_context   # empty-payload contract
python3 -c "import ast;ast.parse(open('render-modal/modal_app.py').read())"
```
