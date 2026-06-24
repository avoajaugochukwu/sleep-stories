# Project guide for Claude

Next.js app that turns a script + narration audio into a Remotion sleep video:
UI breaks the script into scenes + images → uploads audio to S3 → Lambda renders
the composition (crossfading scenes, slow stars/fog/light-rays/grain) to S3.

There are **two ways in**: the interactive UI (`/scenes` → `/render`), and a
**headless Baserow/ClickUp ingest pipeline** that does the whole thing on its own
(see "Ingest pipeline" below). Both end at the same Lambda render.

## Always-on rules

**Auto-redeploy — do not ask.** The Lambda renders the **deployed site bundle**,
not local files. When you edit files that affect what runs on Lambda, redeploy in
the background:

- `npm run deploy:site` — after changes to `remotion/**`, `remotion.config.ts`,
  or any `lib/*` file imported by the Remotion bundle (currently
  `lib/remotion/types.ts`). Re-bundles + uploads to the same URL; no env change.
- `npm run deploy:lambda` — after changes to `scripts/deploy-lambda.mjs`, or when
  the `@remotion/lambda` version actually moves. Never deploy a function whose
  name would collide with prod's (`…mem10240mb-disk10240mb…`).

Verify the exit code when each job completes; non-zero = stale code on Lambda.

**Type-check after edits.** Run `npx tsc --noEmit` after editing any `.ts`/`.tsx`
(the Next build also type-checks, but tsc is faster for a quick pass).

**Update `CHANGELOG.md` — do not ask.** After any infra/config change (Lambda
disk/memory, bucket, env vars, deploy scripts) or any non-obvious bug fix,
prepend an entry to `CHANGELOG.md` under today's date (newest first): what
changed, *why* (the symptom/error), and any name/env value that moved. This is
how we avoid relearning the same failures.

## AWS facts (don't relearn these)

- Region **us-west-2** (same as the remotion-test-2 production stack, for its
  1500 Lambda concurrency).
- Our **own dedicated bucket** `remotionlambda-uswest2-sleepstories` — nothing
  shared with prod. Holds `audio/` (uploads), `renders/` (output),
  `sites/sleep-stories/` (the bundle); 7-day lifecycle on `audio/` + `renders/`.
- Our **own function** `remotion-render-4-0-451-mem10240mb-disk2048mb-900sec` —
  distinct from prod's `…disk10240mb…`, so prod is never touched.
- Two `remotionlambda-…` buckets exist in the region, so `renderMediaOnLambda`
  passes `forceBucketName` (= `REMOTION_RENDER_BUCKET`) to pick ours. Expected,
  not a workaround — Remotion otherwise refuses to guess between buckets.
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
  has no DOM here) → Lambda render → stores the finished `WorkflowExport` as the
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
- This is **separate** from the Remotion Lambda/site deploys above — those push
  the render bundle to S3; this pushes the web app + ingest worker to Railway.

## Where to look

- `remotion/` — the video composition (bundled by Webpack; relative imports only,
  the `@/` alias does not work here).
- `lib/remotion/` — input builder, Lambda client, shared types; `start-render.ts`
  is the shared "build input + plan text + kick Lambda" core (UI route + worker).
- `lib/jobs/` — ingest worker, Turso store, ClickUp/Baserow clients, board config.
- `app/api/render/*` — start a render + poll progress; `app/api/renders` lists the
  last 7 days from our bucket.
- `app/api/jobs/*` — ingest, job list, per-job control.
