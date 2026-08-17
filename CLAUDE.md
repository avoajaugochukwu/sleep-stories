# Project guide for Claude

Next.js app that turns a script + narration audio into a sleep video:
UI breaks the script into scenes + images → uploads audio to S3 → a **Modal**
ffmpeg app composites the video (crossfading scenes, slow stars/fog/light-rays/
grain) and writes the MP4 to S3.

There are **two ways in**: the interactive UI (`/scenes` → `/render`), and a
**headless Baserow/ClickUp ingest pipeline** that does the whole thing on its own
(see "Ingest pipeline" below). Both end at the same Modal render.

## Always-on rules

**Rendering runs on Modal — NOT AWS Lambda/Remotion (both deleted 2026-07-01).**
Video is composited by an ffmpeg app on Modal (`render-modal/modal_app.py`),
called via `lib/render/modal.ts` (`RENDER_API_BASE`). There is no site bundle to
deploy and no Lambda function to keep warm. **Never** reintroduce `@remotion/*`,
`renderMediaOnLambda`, or `deploy:lambda` — prod's Lambda stack shares this AWS
account and must stay untouched. To redeploy the renderer, push the Modal app
(`render-modal/`), not this repo. `deploy:site` now only provisions the S3 bucket.

**A build must never need a runtime secret.** `next build` evaluates route
modules, so a client constructed at import (rather than behind a lazy getter)
kills the build on a missing key. Verify: move `.env.local` aside,
`npm run build`, move it back.

**Type-check after edits.** Run `npx tsc --noEmit` after editing any `.ts`/`.tsx`
(the Next build also type-checks, but tsc is faster for a quick pass). For the
scene path also run `npm run check:agents` (32 offline), `npm run check:cut`
(18) and `npm run check:align` (11). All three are offline — no key, no network.

**Update the changelog — do not ask.** After any infra/config change (bucket,
env vars, Modal/Railway deploy, agent prompts or caps) or any non-obvious bug
fix, prepend an entry under today's date (newest first) in the **current
month's file** `docs/changelog/YYYY-MM.md` (create it if the month is new, then
add it to the `docs/CHANGELOG.md` index) — what changed, *why* (the
symptom/error), and any name/env value that moved. This is how we avoid
relearning the same failures. Keep entries tight — one or two bullets. Old
entries about deleted systems are marked `~~(dead code)~~` and kept only for the
lesson they carry.

## AWS facts (don't relearn these)

- Region **us-west-2**. We now only use **S3** here (no Lambda). The
  remotion-test-2 **prod Lambda stack shares this account** — leave its
  `remotion-render-…disk10240mb…` functions alone.
- Our **own dedicated bucket** `sleep-stories-media` — holds `audio/` (uploads)
  + `renders/<id>/<slug>.mp4` (Modal output), public-read + CORS + 7-day
  lifecycle on both. Provisioned by `npm run deploy:site` (bucket name comes from
  `REMOTION_RENDER_BUCKET`). A bucket policy also grants the account write/list so
  Modal's creds can PUT. **Scene images are NOT here** — they come from the shared
  `open-source-image-generation` bucket via the image-gen Modal endpoint; don't
  touch that bucket.
- Modal writes renders via `SLEEP_RENDER_BUCKET` (default `sleep-stories-media`)
  in `render-modal/modal_app.py`; the Next app reads via `REMOTION_RENDER_BUCKET`.
  Keep the two in sync if the bucket ever moves.
- Config + AWS keys are in `.env.local` (gitignored).

## Ingest pipeline (Baserow/ClickUp → headless render)

Mirrors the **footage-collector** app so one n8n/Baserow automation can fan out
to both with the same contract. Lives in `lib/jobs/` + `app/api/jobs/`.

- **Entry:** `POST /api/jobs/ingest` — header `x-ingest-secret: $INGEST_SECRET`;
  body `{ taskId, listId?, script, audioUrl, name?, baserowRowId? }`. Idempotent
  (same `taskId` never double-processes). `audioUrl` is **required** (the render
  needs it; footage-collector left it optional). Returns
  `{ ok, taskId, created, status, url }` where `url` = `/scenes?job=<taskId>`.
- **Worker** (`lib/jobs/worker.ts`) — in-process drain loop, **requires the
  long-lived Railway server** (won't run on serverless). Does the whole pipeline
  headless: `breakdownScript` → one image per scene (bounded concurrency, per-image
  retry) → **gate**: any missing image parks the job as `needs_images` rather than
  rendering a broken video → audio duration (`music-metadata`, since the browser's
  `<audio>` trick has no DOM here) → Modal render → stores the finished
  `WorkflowExport` as the job's `project_json`. Flips ClickUp status (in-progress → done) and flags the
  Baserow row `video_processed`. Cooperative cancel. All ClickUp/Baserow
  writebacks are best-effort (caught) — a missing status label or wrong row never
  blocks the render.
- **Store:** Supabase Postgres table `sleep_jobs`, in the **same DB footage-collector uses**
  (FC's table is `footage_jobs` — no collision). 7-day retention after ClickUp
  marks done.
- **Dashboard:** `/jobs` is the **one** screen (the old `/renders` now
  redirects here). `GET /api/jobs` returns live job rows **plus** every finished
  render from the last 7 days, grouped by channel. A render whose job ClickUp
  marked complete (so the job row is hidden) is re-attached via `listAllJobs()`
  keyed on `renders[0].renderId`, so its ClickUp + "Open project" links survive;
  headless renders with no job show under "Unassigned". Rows offer Watch (browser)
  / MP4 (download) / Uploaded toggle / Delete. `POST /api/jobs/[taskId]`
  `{ action: retry|cancel|delete }`.
- **Hydration:** opening `/scenes?job=<taskId>` runs `JobHydrator`, which polls
  the job and loads the prebaked `WorkflowExport` through the existing
  import path — so images + audio persist for re-render and thumbnail picking.
- **Boards:** `lib/jobs/config.ts` maps two ClickUp lists: `901113872792`
  (ClickUp name **"Sleep Retreat Channel"** — renamed 2026-08-12 from "Midnight
  Mysteries", earlier "Sleep Stories") and `901114309009` (**"Space Sleep
  Journey"**, added 2026-08-12). Labels are display-only; routing is by listId, so
  a ClickUp rename never breaks ingest — only the label follows. The
  plausible-looking `901113798933 "Space Cluster"` is *footage-collector's* WW2
  board despite the name — genre rides inference, not the board.
  Status labels default to `in progress`/`fc done`/`complete`,
  overridable via `CLICKUP_STATUS_IN_PROGRESS|DONE|COMPLETE` env.
- **Env (all on Railway + `.env.local`):** `INGEST_SECRET`, `SUPABASE_DB_URL`,
  `CLICKUP_API`, `BASE_ROW_URL`, `BASEROW_EMAIL`,
  `BASEROW_PASSWORD`, `BASEROW_TABLE_ID`. (`INGEST_SECRET`/`CLICKUP_API`/Supabase are
  the *same values* as footage-collector.)

## Deployment (the Next app itself)

- Hosted on **Railway** — project `ui-helpers`, service **`sleep-stories`**,
  public URL `https://sleep-stories.up.railway.app`. (Sibling service to
  footage-collector in the same project.) The worker depends on this being a
  long-lived process.
- Deploy with `railway up --service sleep-stories` from this dir (CLI already
  linked). Setting env vars: `railway variables --set "K=V" --skip-deploys`.
- This is **separate** from the Modal renderer (`render-modal/`) and the
  `deploy:site` bucket provisioner; this pushes the web app + ingest worker.

## Where to look

- `docs/CHANGELOG.md` — the **index** only. Every month, current one included,
  is its own file `docs/changelog/YYYY-MM.md`, newest first; add new entries to
  the current month's file, not the index. The *why* behind most of the
  odd-looking decisions is in there.
- `agents/` — Python agent layer (`script_context`, `scene_director`) +
  `agents/CLAUDE.md` for its operating rules. **This is the production scene
  path**; `lib/scene-engine/script-to-scenes.ts` is the orchestrator that cuts
  the script and calls them through `lib/agents/bridge.ts`. Prompts, caps and
  denylists live in `agents/`, never in `lib/`. Each agent batches internally —
  TS hands over the whole script or the whole scene list in one spawn.
- `lib/scene-engine/cut-script.ts` — the scene cut, and **only** the cut: it
  decides where scenes start, never how long they last. **No model**: sentence
  boundaries from `compromise`, then the first `OPENING_SCENES` (20) take
  `OPENING_SENTENCES` (2) each and the rest take `SENTENCES_PER_SCENE` (5) — a
  faster opening changes the image more often while a viewer is still deciding
  to stay. Every snippet is a slice of the original so
  `snippets.join('') === script`; that invariant is what Whisper alignment rides
  on, so a non-verbatim snippet shifts every scene after it.
- `lib/align/` — **scene timing, and the reason images sit on the right
  sentences.** `index.ts` uploads the narration to the `whisper-transcribe` Modal
  app (async `/v1/jobs` + poll, override with `WHISPER_TRANSCRIBE_URL`) and turns
  word timestamps into per-scene durations; `dtw.ts` is ONE global DTW over the
  whole script vs the whole transcript, sliced per scene; `normalize.ts` folds
  spelled-out numbers to digits ("nineteen forty-five" → 1945) because Whisper
  writes digits and the script spells them out. Ported from remotion-test-2.
  **Never make the DTW per-scene/windowed** — that version drifted a cursor on
  every weak match and cascaded into the rest of the video. **No fallback on
  purpose**: unmatched scenes throw, because a guessed timing ships a video whose
  images are on the wrong lines and nothing downstream can see that.
- Checks: `npm run check:agents` (32), `npm run check:cut` (18),
  `npm run check:align` (11). All offline, no key/network.
- `lib/jobs/scene-image.ts` — image generation. `STYLE_PREFIX` is prepended at
  generation time, after `stripLeadingStyle()` strips a leading copy, so
  `visual_prompt` stays the raw prompt and retries are idempotent. Storing the
  final prompt back into `visual_prompt` double-prefixed 44% of scenes once.
- `render-modal/` — the Modal ffmpeg renderer (Python) that composites the
  video. Overlay clips are `<pack>-*.mp4` and their durations are **ffprobed at
  render time**, not hardcoded — the duration is a modulo for the source seek,
  and a stale constant makes the clip jump.
- `lib/render/` — `modal.ts` (HTTP client for the renderer: start + poll),
  `start-render.ts` (align to the narration, pick a title, kick Modal — shared by
  the UI route and the worker, so neither can render on a guess) and
  `sound-effects.ts` (the ambient-bed labels). Was `lib/remotion/`; renamed
  2026-07-31 because nothing in it had touched Remotion since Lambda was deleted.
- `lib/jobs/` — ingest worker, Supabase store, ClickUp/Baserow clients, board config.
- `app/api/render/*` — start a render + poll progress. `app/api/renders` still
  lists the last 7 days from our bucket (POST toggles the uploaded flag, DELETE
  removes a take); `/api/jobs` folds those renders into the unified dashboard, and
  the `/render` editor step still embeds `RenderHistory`.
- `app/api/jobs/*` — ingest, job list, per-job control.
