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

**Type-check after edits.** Run `npx tsc --noEmit` after editing any `.ts`/`.tsx`
(the Next build also type-checks, but tsc is faster for a quick pass).

**Update `CHANGELOG.md` — do not ask.** After any infra/config change (Lambda
disk/memory, bucket, env vars, deploy scripts) or any non-obvious bug fix,
prepend an entry to `CHANGELOG.md` under today's date (newest first): what
changed, *why* (the symptom/error), and any name/env value that moved. This is
how we avoid relearning the same failures.

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
  headless: `breakdownScript` → image pool (cap `MAX_GENERATED_IMAGES`, overflow
  reuse) → audio duration (`music-metadata`, since the browser's `<audio>` trick
  has no DOM here) → Modal render → stores the finished `WorkflowExport` as the
  job's `project_json`. Flips ClickUp status (in-progress → done) and flags the
  Baserow row `video_processed`. Cooperative cancel. All ClickUp/Baserow
  writebacks are best-effort (caught) — a missing status label or wrong row never
  blocks the render.
- **Store:** Turso table `sleep_jobs`, in the **same DB footage-collector uses**
  (FC's table is `footage_jobs` — no collision). 7-day retention after ClickUp
  marks done.
- **Dashboard:** `/jobs` page (`components/jobs/`), header **Jobs** link + ready
  badge. `GET /api/jobs` lists + re-checks ClickUp (hides complete/deleted).
  `POST /api/jobs/[taskId]` `{ action: retry|cancel|delete }`.
- **Hydration:** opening `/scenes?job=<taskId>` runs `JobHydrator`, which polls
  the job and loads the prebaked `WorkflowExport` through the existing
  import path — so images + audio persist for re-render and thumbnail picking.
- **Boards:** `lib/jobs/config.ts` maps ClickUp list `901113872792`
  ("Sleep Stories"). Status labels default to `in progress`/`fc done`/`complete`,
  overridable via `CLICKUP_STATUS_IN_PROGRESS|DONE|COMPLETE` env.
- **Env (all on Railway + `.env.local`):** `INGEST_SECRET`, `TURSO_DATABASE_URL`,
  `TURSO_AUTH_TOKEN`, `CLICKUP_API`, `BASE_ROW_URL`, `BASEROW_EMAIL`,
  `BASEROW_PASSWORD`, `BASEROW_TABLE_ID`. (`INGEST_SECRET`/`CLICKUP_API`/Turso are
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

- `render-modal/` — the Modal ffmpeg renderer (Python) that composites the video.
- `lib/render/modal.ts` — HTTP client for the Modal renderer (start + poll).
- `lib/remotion/` — input builder + shared types; `start-render.ts` is the shared
  "build input + plan title + kick Modal" core (UI route + worker). (Dir keeps its
  old name; it no longer depends on any `remotion` package.)
- `lib/jobs/` — ingest worker, Turso store, ClickUp/Baserow clients, board config.
- `app/api/render/*` — start a render + poll progress; `app/api/renders` lists the
  last 7 days from our bucket.
- `app/api/jobs/*` — ingest, job list, per-job control.
