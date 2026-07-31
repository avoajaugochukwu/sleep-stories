# Handoff — 2026-07-31

Written at the end of a long session. Read this first, then `session.md` (running
log) and `PLAN-AGENTS.md` (the agent spec + live findings).

---

## ⚠️ Read before touching anything

**Nothing from this session is committed. Working tree is on `main` with ~30
changed files, including binary asset renames.** Last commit is `67782ad`
(Turso → Supabase), which predates everything below.

```bash
git status --short      # ~30 entries
git log --oneline -1    # 67782ad — everything since is uncommitted
```

The renames are staged (`git mv`), so `git status` shows them as `R`. A careless
`git checkout .` or `git stash` loses a full session of work **and** the
re-encoded 61MB overlay clip. Commit or branch before doing anything destructive.

Suggested first action:

```bash
git checkout -b agents-and-queue
git add -A && git commit    # see "What changed" below for a message
```

---

## State in one paragraph

The app now lands on a job queue instead of the scene editor; jobs have their own
URLs and honestly report whether a video is rendering or rendered. It builds and
deploys via **Docker, not Nixpacks** (hard requirement — the user said so twice).
The three-agent Python layer under `agents/` **is now the production scene
path**; the old TypeScript prompts and coverage-repair code are deleted, no A/B
was run, and refinement happens on the agents from here. Overlay clips are
prefixed by pack (`fire-*`, `space-*`), space footage is in the repo, and
`overlayPack` is threaded end to end — but **Modal has not been redeployed**, so
the renderer still has the old filenames baked into its image. That is now a
blocker, not a nicety: something finally sends `overlayPack`.

---

## Deployed vs local — THEY DIVERGE

Railway service `sleep-stories`, project `ui-helpers`,
`https://sleep-stories.up.railway.app`.

**Deployed** (last `railway up`, deployment `d313c117`):
- Docker build, python 3.11.2 in the image, all 3 agents importable
- `/` → `/jobs` redirect; `/jobs/[taskId]` pages; derived render states
- header rework; session tools moved out of the header
- `openai` lazy-Proxy build fix

**Local only — NOT deployed:**
- overlay renames + the 4 new `space-*` clips
- `render-modal/modal_app.py` pack selection
- `overlayPack` plumbing in `lib/render/modal.ts` / `start-render.ts`
- genre inference in `script_context`

**Modal renderer: NOT redeployed at all this session.** Its image still contains
the OLD overlay filenames (`red_faint_fire.mp4`, not `fire-red_faint_fire.mp4`).
Deploying the Next app without redeploying Modal is safe today only because
nothing sends `overlayPack` yet and Modal's own copy of the files is unchanged.
**The moment you redeploy Modal you must have the renamed files**, or
`overlay_pool()` finds nothing and falls back to a `fire-` prefix that also does
not exist in the old image.

```bash
modal deploy render-modal/modal_app.py     # not run this session
```

Verify a deploy:
```bash
curl -s https://sleep-stories.up.railway.app/api/agents/health | python3 -m json.tool
# expect runtime.ok true, python 3.11.2, all three agents importable
```

---

## What exists now

### The scene path — wired in and running

Contract copied from `../../../video-agents/military/agents/CLAUDE.md`: JSON on
stdin, JSON on stdout, logs on stderr, exit nonzero on failure. Read
`agents/CLAUDE.md` before editing anything in there.

| step | job | state |
|---|---|---|
| `cut-script.ts` | script → scene snippets. **No model.** `compromise` for sentence bounds, a cut every 5 sentences, every snippet a slice | 14 checks |
| `script_context` | whole-script grounding **+ genre classification** | 15 checks, live 4/4 |
| `scene_director` | snippets → `visual_context` + `negative_prompt` | 17 checks, both genres live |

```bash
npm run check:agents    # 32 offline checks, no API key, no network
npm run check:cut       # 14, runs the TS directly via --experimental-strip-types
```

**`scene_splitter` was deleted**, and the three versions it went through are
worth knowing before anyone rebuilds one — see "Better than validating" in
`agents/CLAUDE.md`. Short version: nothing downstream cares where a scene
starts, only that the scenes tile the script.

Also: `lib/agents/bridge.ts` (typed wrapper per agent),
`app/api/agents/health/route.ts` (invokes every agent on an empty payload —
that is why it is free and keyless; **do not break the empty-input early
return**, the Docker build gate depends on it too).

### Genre is inferred, not configured

`script_context` classifies the script and returns `genre` + `overlay_pack`.
Payload `genre` is an **override**, not the normal path. Measured live with
nothing supplied: Cassini → `space`, Somme → `history`, body-scan meditation →
`abstract` (correctly empty grounding), and a WWI script saying "burst like a
supernova" → `history` (the trap case). 4/4.

### There is no overlay agent, on purpose

Clips are prefixed by pack. `modal_app.py` lists `<pack>-*.mp4` and ffprobes
durations at render time. So "which overlays" is `OVERLAY_PACK[genre]` — a dict
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

## Next steps, in order

### 1. Redeploy Modal FIRST, then Railway

Order matters now. `overlayPack` is live in the app, so shipping the app against
the current Modal image means `overlay_pool()` looks for `space-*.mp4` in an
image that only has the pre-rename filenames, finds nothing, and falls back to a
`fire-` prefix that also is not there.

```bash
modal deploy render-modal/modal_app.py    # picks up public/overlays/* as renamed
railway up --service sleep-stories
```

### 2. Run one real job and look at the images

No A/B was run before deleting the TS path, so the first job is the test.
Reassembly is no longer the thing to check — the snippets are slices and
`cutScript` asserts the join, so drift cannot happen silently any more. What is
untested on real content is **image quality from `scene_director`**, which is
the one place output still comes from a model.

The completed Somme job (`868kj78jw`, 176 scenes, 69,751 chars) is the reference
for what the old path produced:

```bash
curl -s https://sleep-stories.up.railway.app/api/jobs/868kj78jw -o /tmp/somme.json
python3 -c "
import json; d=json.load(open('/tmp/somme.json'))
sb=d['projectJson']['state']['storyboardScenes']
print(len(sb),'scenes'); print(sb[0]['visual_prompt'][:200])"
```

Also grep the worker log for `SALVAGED` — that is the director having given up
on a scene and reused a neighbour's imagery. Rare is fine; common means the
prompt or the checks in `scene_director/checks.py` need attention.

### 3. Watch cost and latency

The old path made 1 + N LLM calls (one global pre-pass, one per chunk). The new
one makes 1 + ceil(scenes/8) — `script_context` once, then the director in
batches of 8. The cut costs nothing. Effort is `low` everywhere, but the
director is still paid on every scene of every video.

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
- **`closeCoverageGaps` and `healSnippet` are gone entirely**, along with the
  agent that replaced them. Both existed to repair scene text after a model had
  copied it out; `cut-script.ts` never lets a model near the text, so there is
  nothing to repair. Their bugs (`indexOf` from position 0, so repeated
  narration resolved to the first occurrence; whitespace-only gaps skipped) are
  a good argument against ever reintroducing the shape.
- **`compromise` is load-bearing.** A regex on `[.!?]\s` splits "Mr. Smith",
  "Dr. Reed", "the U.S. Army" and "$4.50" mid-sentence. It is used for boundary
  *offsets* only — its strings are normalized and must never become snippet
  text. Covered by `npm run check:cut`.
- **ClickUp list `901113872792` is named "Midnight Mysteries"**, not "Sleep
  Stories". `901113798933 "Space Cluster"` is *footage-collector's* WW2 board
  despite the name. There is no space list; genre rides the payload/inference.
- **`fc done` was added to the board by the user** on 2026-07-31, so
  `STATUS_DONE` writeback works from the next job onward. It had silently
  no-opped forever before that.
- **`lib/ai/anthropic.ts` was deleted** — zero importers, and it had the same
  eager-construction landmine. Recoverable from git.
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
2. **No A/B was run, by decision.** The old TS path is deleted rather than kept
   alongside for comparison; refinement happens on the agents. The cost is that
   the first real job is the test, and the failure that matters (snippet drift)
   is silent — see step 2 above for the one command that catches it.
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
