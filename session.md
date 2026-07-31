> **Starting a new session? Read `HANDOFF.md` first.** It carries the deployed-vs-local
> divergence, the uncommitted-work warning, and the ordered next steps. This file is
> the running log behind it.

# Session log — agent refactor + a second genre (space)

Started 2026-07-30. Two goals, in this order:

1. **Refactor the scene layer into Python agents**, matching the contract in
   `../../../video-agents/military/agents/CLAUDE.md`.
2. **Add a space/cosmos genre** without an `if (genre === 'space')` branch
   anywhere in the app.

(2) is the reason for (1). The military repo's rule — *"keep creative knowledge
in agent instructions or tools, not hardcoded app branches"* — is exactly the
line this app is about to cross.

---

## Done this session

- **Fixed: a prebaked job's render was invisible, so the UI invited a duplicate
  paid render.** See CHANGELOG 2026-07-30. Touched
  `components/workflow/render-panel.tsx` and `components/workflow/job-hydrator.tsx`.
  No new API call — the state was already in the store, nothing rendered it.
- **Built the three agents + the bridge + the health route.** 42 offline checks,
  both genres verified live end-to-end. **Not wired in** — production still runs
  `lib/scene-engine/no-gap-breakdown.ts`. Status table and live findings are in
  `PLAN-AGENTS.md`.
- **Dockerfile + `.dockerignore` written.** Railway will build via Docker instead
  of Nixpacks the next time this service deploys — that is the point (Nixpacks'
  Next.js image has no system python). Runtime model is unchanged: still
  `npm run start`, so the worker's long-lived drain loop is unaffected. Build
  gate runs all three agents on empty payloads plus the 42 offline checks, so a
  broken python layer fails the BUILD instead of every job.
  **Not verified: the image has never been built** — no docker daemon on this
  machine. The gate's exact shell commands were run locally and pass. First
  `railway up` is the real test.
- **Resolved: there is no space ClickUp list.** Enumerated the workspace. The
  sleep board is `901113872792`, which ClickUp names **Midnight Mysteries**;
  `lib/jobs/config.ts` had it labelled "Sleep Stories" (now fixed). The
  plausible-looking `901113798933 "Space Cluster"` is footage-collector's WW2
  board — its tasks are `[Attch] Hitler's Tank Designer…`. So genre rides the
  ingest payload on the existing list, and no new ClickUp setup is needed.
- **Found while looking: `STATUS_DONE` writeback has never worked on this board.**
  Default is `"fc done"`; Midnight Mysteries has only `to do` / `in progress` /
  `complete`, and no `CLICKUP_STATUS_DONE` override exists in `.env.local` or on
  Railway. The call is best-effort and caught, so nothing fails — a job whose
  render has started just stays "in progress" in ClickUp until a human marks it
  complete. Documented at the constant, **not changed**: picking a different
  status changes the ClickUp workflow, which is not this file's call.

---

## What the scene layer actually is today

Measured, not assumed:

| Piece | Lines | Owns |
|---|---|---|
| `lib/scene-engine/script-splitter.ts` | 58 | Deterministic chunking, 40 sentences/chunk |
| `lib/scene-engine/no-gap-breakdown.ts` | 282 | Both LLM calls + `healSnippet` + `closeCoverageGaps` |
| `lib/scene-engine/sleep-scene-prompt.ts` | 90 | The whole creative brief, one string |
| `lib/scene-engine/story-text.ts` | 72 | Title + caption text |
| `lib/jobs/scene-image.ts` | — | `STYLE_PREFIX`, `BASE_NEGATIVE`, image call |

Model: `gpt-5-mini`, `reasoning_effort: low`, `chat.completions`, JSON mode
(`lib/ai/openai.ts`). Calls per job: **1 global-context pre-pass + ceil(sentences/40)
chunk calls**, at `CHUNK_CONCURRENCY = 6`.

### Two things that change the plan

- **The no-gap guarantee is already code, not prompt.** `healSnippet` heals a
  snippet back to an exact substring; `closeCoverageGaps` reassigns any gap to a
  neighbour. So the hardest deterministic guarantee is *already* on the right
  side of the LLM-judges/code-enforces line. This is not the part that needs
  rescuing.
- **LLM cost is not the problem here.** A 176-scene job makes ~5 model calls and
  176 image generations. Image spend dominates by orders of magnitude. So the
  codex-subscription routing that justifies itself in the military repo
  (~174 vision calls/job) has **no equivalent payoff here** — do not port it on
  reflex. Revisit only if per-scene agent calls are ever introduced.

### What IS wrong

`sleep-scene-prompt.ts` is one prompt owning **five** decisions: scene
splitting, verbatim coverage, visual authoring, period/technology lock, and
negative prompts. That is the `authorBatch` anti-pattern the military
`agents/CLAUDE.md` names by name — *"which is why fixing any one of them meant
editing a prompt that four other behaviours depended on."*

Concretely, for space: `GLOBAL_CONTEXT_PROMPT` orders the model to pin an exact
year ("France, 1916"), and the persona layer carries
`PERIOD- AND PLACE-ACCURATE (CRITICAL)` + `TECHNOLOGY PERIOD-LOCKED (CRITICAL)`
plus per-scene era negatives. On a nebula those instructions are not merely
unused — they actively fight the output (a negative prompt excluding "electric
lights, cameras, plastic" on a shot of Saturn). The escape hatch ("if the topic
is timeless or abstract, say so") means it degrades rather than fails, which is
worse: it ships mediocre and nobody gets paged.

---

## Proposed agent split

> Full spec — I/O contracts, `checks.py` contents, build order — is in
> **`PLAN-AGENTS.md`**. Summary only below.

One job per agent. Deliberately **three**, not five — captions and chunking stay
deterministic TS because neither is a creative judgement call.

| Agent | Input | Output | Why it is its own agent |
|---|---|---|---|
| `script_context` | whole script | topic, tone, setting; era **or** an explicit "timeless/abstract" | Runs once. Its output is the only thing that should know what genre this is. |
| `scene_splitter` | one chunk + context | `script_snippet[]` | Purely mechanical goal (contiguous verbatim coverage). `checks.py` owns it; the existing `healSnippet`/`closeCoverageGaps` logic ports over as the repair half. Genre-blind. |
| `scene_director` | snippets + context | `visual_context` + `negative_prompt` per scene | **This is the swappable one.** Military-history direction and cosmos direction are two instructions for this one agent. Nothing else changes between genres. |

`checks.py` owns, per military doctrine (a prompt is a suggestion, a clamp is a
guarantee): contiguous coverage, char-for-char snippets, scene-count caps, the
SFW ban, and the image cap. **The SFW ban moves out of the prompt.** Today it is
prose in `sleep-scene-prompt.ts` marked `ABSOLUTE`; prose is not absolute. It
becomes a check.

### Cost of the split, stated honestly

Splitting one chunk call into splitter + director is **2 calls per chunk instead
of 1**, plus military's measured ~11.4k tokens of agent preamble per call. On
current volumes (~5 calls/job) that is noise next to image spend. It stops being
noise if the director ever goes per-scene. Keep it per-chunk.

---

## Phases

Ordered so the thing that unblocks space lands first, and nothing is wired in
unproven (military: *"Prove before wiring"*).

- **Phase 1 — infra.** Port `agents/shared/{llm,config}.py`, `agents/CLAUDE.md`,
  `lib/agents/bridge.ts`, the Dockerfile build gate, `/api/agents/health`.
  Copied, not redesigned. Railway moves off Nixpacks onto the Dockerfile — same
  switch the military service already made.
  ⚠️ This app's worker is a long-lived Railway process; verify the Dockerfile
  does not break `lib/jobs/worker.ts`'s drain loop.
- **Phase 2 — `scene_director`.** The genre-swappable agent, extracted from the
  existing prompt. A/B against current output on a real script before wiring.
- **Phase 3 — `scene_splitter`.** Coverage rules into `checks.py`. Highest
  regression risk in the repo: audio alignment depends on snippets
  reconstructing the script exactly. Do not start before Phase 2 is proven.
- **Phase 4 — `script_context`,** with genre as a first-class output rather than
  a forced historical year.
- **Phase 5 — space genre.** A second `scene_director` instruction + a board
  entry in `lib/jobs/config.ts` (`BOARDS` already exists and `boardForList` is
  already threaded through the worker). Renderer changes are separate and small:
  `stars.mp4` is already screen-blended on every scene, but `OVERLAY_POOL` in
  `render-modal/modal_app.py` is fire/smoke/bubbles — earthbound. `love_vortex`
  and `full_screen_light_cloud` pass as nebula; the rest need swapping.

Nothing here is started. The app is unchanged apart from the render-gating fix.

---

---

## Queue with per-job URLs and visible render status — **DONE 2026-07-31**

Built as specified below. What landed:

- `lib/jobs/render-state.ts` — `deriveJobState()`, the one place that decides a
  job's state. Nine states; derived on read, never stored.
- `app/jobs/[taskId]/page.tsx` + `components/jobs/job-detail.tsx` — the per-job
  URL. Does **not** mount the session store.
- `components/jobs/state-style.ts` — colours only. The *words* come from the
  server, so a row and its page cannot disagree.
- `/api/jobs` and `/api/jobs/[taskId]` both return `state` / `stateLabel` /
  `stateDetail` / `renderExists`.
- `components/jobs/ready-tasks-badge.tsx` — was counting `status === "ready"`,
  i.e. advertising finished videos while they were still rendering. Now counts
  the derived `rendered`.

Two deliberate asymmetries: the list route does **not** ask Modal for progress
(one call per row per poll), the job page does — that is what turns "Rendering"
into a real percentage and a dead render into "Render failed" instead of a bar
that never moves. And "Open project to fix" is only offered for `needs_images` /
`needs_render`, because the editor is where the Render button lives.

The original spec follows, unchanged.

### The problem

A job is not a page here. It is a query param on the editor: `/scenes?job=<taskId>`.
`JobHydrator` fetches it and dumps the prebaked `WorkflowExport` into the global
session store. Consequences:

- **No stable per-job URL.** You cannot link a teammate to one job, cannot open
  two, and a refresh races the IndexedDB rehydrate.
- **Render status is not a first-class field.** It has to be dug out of
  `projectJson.state.renders[0]`, which is exactly why the duplicate-render bug
  happened. The 2026-07-30 fix surfaces it, but from store state — the underlying
  shape is still "render status is a detail inside a blob".
- `/jobs` lists jobs but each row's `url` is that same query-param link.

### The military shape to copy

| Military | Here today | Wanted |
|---|---|---|
| `app/tasks/page.tsx` | `/jobs` + `components/jobs/jobs-panel.tsx` | keep, add status column |
| `app/review/[id]/page.tsx` | — (none) | `app/jobs/[taskId]/page.tsx` |
| `app/api/collections/[id]/*` | `app/api/jobs/[taskId]` | already the right shape |

So the API half already exists. The missing piece is the **page**.

### What it needs to show

One render-status field, same vocabulary in both places — the queue row and the
job page:

- `queued` / `generating images N/M` — no render yet
- **`rendering — N%`** — Modal is working, do not start another
- **`rendered`** — MP4 link, do not start another
- `render failed` — the only state where starting another is the right move
- `needs images` — parked, render deliberately skipped

The two "do not start another" states are the whole point. Right now the queue
row shows worker progress only and goes quiet once the render starts, which
reads identically to "nothing is happening".

### Notes for whoever builds it

- `GET /api/jobs` already resolves the MP4 URL by render id against the 7-day S3
  listing (`app/api/jobs/route.ts:75`). The data is there; it is a presentation
  job, not a plumbing job.
- Status must be **derived on read, in one place**, not stored — a stored copy
  goes stale against Modal. One helper both the list route and the job page call.
- Keep `/scenes?job=` working. It is the edit-and-re-render path and the ingest
  endpoint returns that URL today. The new page links *to* it, does not replace it.
- The job page should NOT mount the global session store. That coupling is what
  makes the current flow fragile.

---

## Open questions — need answers before Phase 1

1. **Repo location.** Decision was "refactor in place, don't relocate". Confirm
   sleep-stories stays at `ui/stories/sleep-stories` rather than moving to
   `video-agents/sleep`. If it should move, that happens *before* Phase 1, not
   after.
2. **Space board.** Need the ClickUp list id for the space board (military's
   equivalent lives in `lib/jobs/config.ts` `BOARDS`). Is it a new board, or the
   same Sleep Stories list with a genre field on the Baserow row?
3. **Genre source of truth.** Should genre come from the ingest payload
   (explicit, dumb, reliable) or be inferred by `script_context` (automatic,
   one more thing that can be wrong)? Explicit is the lazier and safer default —
   confirm.
4. **`STYLE_PREFIX`.** `"highly detailed digital painting, "` is hardcoded in
   `lib/jobs/scene-image.ts:10`. Per genre, or global? If per genre it belongs
   with the director instruction, not in TS.

## Loose end found while reading

`lib/ai/anthropic.ts` exports `DEFAULT_MODEL = 'claude-sonnet-4-20250514'` and
has **zero importers** across `app/`, `lib/`, `components/`. Vestigial — same
shape as the unused `ANTHROPIC_API_KEY` flagged in the military session log.
Confirm, then delete.
