# Changelog

Infra/config changes and non-obvious bug fixes worth not relearning. Newest first, dates YYYY-MM-DD.

**~~(dead code)~~** marks an entry about a system that no longer exists, kept only for the lesson it
carries: Remotion + AWS Lambda (deleted 2026-07-01), Turso (now Supabase Postgres),
`no-gap-breakdown.ts` / `sleep-scene-prompt.ts` / `script-splitter.ts` / the `scene_splitter` agent
(deleted 2026-07-31).

**Current architecture: `CLAUDE.md`.** Rules for the Python layer: `agents/CLAUDE.md`.

## 2026-07-31

- **Splitting the script needs no model at all, so `scene_splitter` is deleted.** v1 had the model
  copy each scene's text verbatim, then heal the copy, close coverage gaps, validate the reassembly
  and retry 4× — six mechanisms undoing damage the model could only do *because* it held the text.
  v2 asked for cut markers only and sliced the original string (military app's `sliceBySnippets`),
  making lossless coverage structural. v3 observed that **nothing downstream cares where a scene
  starts**, only that the scenes tile the script — images are per-scene, so a mid-thought cut costs
  nothing measurable, and the model call bought a tidier cut for a round trip per chunk plus a
  failure mode. Now `lib/scene-engine/cut-script.ts` cuts after every 5th sentence
  (`SENTENCES_PER_SCENE`, the one knob), folds a one-sentence remainder back, and asserts
  `snippets.join('') === script`. No word-budget targeting either: sleep narration is even-paced, so
  a fixed sentence count lands close enough. No model, no subprocess, no retry, cannot fail.
  `npm run check:cut` covers it (14 assertions, no framework — `node --experimental-strip-types`
  runs the TypeScript directly).
- **`lib/scene-engine/script-splitter.ts` deleted**, folded into `cut-script.ts`. `compromise` stays
  and earns its place: a regex on `[.!?]\s` splits "Mr. Smith", "Dr. Reed", "the U.S. Army" and
  "$4.50" mid-sentence, and a mid-sentence cut is a visible glitch. It is used for boundary
  *positions* only — each sentence is located forward-only in the original and only the offset kept,
  because `compromise` normalizes characters and **its strings must never become the snippet text**.
  A sentence it mangles costs one candidate cut. The deleted file had a quiet bug: it rebuilt each
  chunk as `sentences.join(' ')`, so the old "byte-exact" contract was really against a rejoined
  copy.
- **`scene_director` takes every scene in ONE spawn and chunks internally** (`CHUNK_SIZE = 12`, 8 in
  flight) instead of TS spawning it per chunk. Batch size decides what a single model call sees, so
  it changes output and belongs beside the prompt — it was in `lib/`, two directories away. 12 is
  untested on a real job; if neighbouring scenes start repeating imagery, drop it back to 8.
- **`scene_director` fills an undirected scene from its nearest directed neighbour instead of
  failing the video.** After the per-chunk bank-and-repair loop it retries stragglers solo, then
  salvages what is still missing and logs `SALVAGED` — Modal does the same a layer down (a scene
  whose image failed reuses the previous image, so audio coverage is never lost). Still throws on
  zero scenes.
- **Python agents wired in; the old TypeScript scene path deleted.** `no-gap-breakdown.ts` renamed
  to `script-to-scenes.ts` ("no-gap" described an invariant, not the job) and gutted 282 → ~70
  lines: a deterministic cut plus two bridge calls (`script_context`, `scene_director`). **No A/B
  was run** — the decision was to wire in and refine on the agents from here. Deleted with it:
  `lib/scene-engine/sleep-scene-prompt.ts` (prompts live in `agents/*/prompt.py` now) and
  `lib/config/development.ts` (zero importers).
- **The LLM fallbacks are gone on purpose.** The old file caught a bad response and collapsed the
  whole chunk into one scene with an empty/boilerplate image prompt, so a failed call shipped a bad
  video instead of failing the job. `script_context` now throws; the cut cannot fail and the
  director salvages.
- **`overlayPack` threaded end to end.** `script_context` infers the genre and derives the pack
  (`agents/shared/genres.py`), `breakdownScript` returns it, `worker.ts` passes it to
  `startRenderForScenes`. Persisted as an optional `overlayPack` on `WorkflowState` so a resumed job
  does not silently fall back to `fire`; not in the store's `partialize`, so a UI export just
  renders with the default pack. ⚠️ **Modal must be redeployed before this ships** — its image still
  has the pre-rename overlay filenames.
- **Jobs now have their own URLs, and the queue says whether a video is rendering or rendered.** A
  job used to exist only as `/scenes?job=<taskId>` — a query param on the editor that dumped the
  prebaked project into the global session store; no stable link, it raced the IndexedDB rehydrate
  on refresh, and render status was buried in `projectJson`. Added `app/jobs/[taskId]/page.tsx` +
  `components/jobs/job-detail.tsx`, which reads only and never mounts the session store;
  `/scenes?job=` is still the edit path. The state is derived in ONE place,
  `lib/jobs/render-state.ts`, called by both `/api/jobs` and `/api/jobs/[taskId]` so a row and its
  page cannot disagree — derived on read, never stored, since a stored copy goes stale the moment
  Modal finishes. Nine states; the two that matter are `rendering` and `rendered`, which the old UI
  collapsed into one badge reading **"Ready"** — when the render had already auto-started.
  `components/jobs/ready-tasks-badge.tsx` had the same bug, counting `status === "ready"` and
  advertising finished videos in the header while they were still rendering; it now counts derived
  `rendered`. Two deliberate asymmetries: the list route does **not** ask Modal for progress (one
  Modal call per row per poll) while the job page does — which is what turns "Rendering" into a live
  percentage and a dead render into "Render failed" rather than a bar that never moves; and "Open
  project to fix" is offered only for `needs_images` / `needs_render`, since the editor is where the
  Render button lives.
- **Railway builds this service from a `Dockerfile`.** Added `Dockerfile` + `.dockerignore`. Reason:
  the `agents/` subprocesses need a system python in the image, or
  `GET /api/agents/health` (and every job) fails in prod. Runtime unchanged (`npm run start`), so
  `worker.ts`'s drain loop is unaffected. The build gate runs every agent on an empty payload plus
  the offline checks, so a broken python layer fails the BUILD, not every job at runtime;
  `.dockerignore` keeps
  `.env*` out of image layers. **`public/` is copied whole (~66MB)** even though `public/overlays`
  and `public/sound-effects` are only read by `render-modal/modal_app.py` at Modal-deploy time — an
  exclusion would break silently the day a served asset lands there. ⚠️ **The image has never
  actually been built** (no docker daemon locally) — the first `railway up` is the real test.
- **The ClickUp list this app writes to is named "Midnight Mysteries", not "Sleep Stories".**
  `lib/jobs/config.ts` had the wrong label on `901113872792`, costing a workspace search every time
  someone reconciles them. Also recorded there: `901113798933 "Space Cluster"` is
  *footage-collector's* WW2 board despite the name, so **there is no space list** — a second genre
  rides the existing board via the ingest payload.
- **`STATUS_DONE` has never applied on this board — documented, not changed.** Default is
  `"fc done"`, but Midnight Mysteries only has `to do` / `in progress` / `complete` and no
  `CLICKUP_STATUS_DONE` override exists in `.env.local` or on Railway. The writeback is best-effort
  and caught, so nothing errors; a job whose render has started simply stays "in progress" until a
  human sets it complete. Left alone because choosing a real status changes the ClickUp workflow.
  Fix: set `CLICKUP_STATUS_DONE` to a status that exists, or add `fc done` to the list.

## 2026-07-30

- **Added the Python agent layer under `agents/`** (`script_context`, ~~(dead code)~~
  `scene_splitter`, `scene_director`) + `lib/agents/bridge.ts` and `GET /api/agents/health`.
  Contract copied from the sibling military-video repo: JSON on stdin, JSON on stdout, logs on
  stderr, **no fallback**. Motivation was a second genre (space): the old single prompt owned five
  decisions at once and its `GLOBAL_CONTEXT_PROMPT` pinned an exact historical year — wrong for a
  cosmos script. Genre now lives in `agents/scene_director/prompt.py` + `agents/shared/genres.py`;
  `lib/` never branches on it.
- ~~(dead code)~~ **Two bugs the Python port found in the TS original, worth never repeating:** (1)
  it located each snippet with `indexOf(snippet)` — always from position 0 — so on repeated
  narration the second occurrence resolved to the first and computed gaps were garbage (use a
  running cursor); (2) it skipped whitespace-only gaps (`if (gap.trim())`), fatal once byte-exact
  reassembly is the contract, because the model drops the inter-sentence space on nearly every call
  — the first live run burned all 4 retries on "missing 2 characters".
- **A prebaked job's render was invisible in the UI, so the Render button invited you to pay for a
  second copy of a multi-hour video.** The worker checkpoints the `RenderJob` into `project_json`,
  so a hydrated project reaches `/render` with `renders` already in the store — `RenderPanel` polled
  them and wrote progress back but never displayed them, and the only visible list was the 7-day S3
  history, empty until the MP4 lands. Fix: `render-panel.tsx` shows a per-render banner (rendering %
  / done + link / failed) and a second take needs two clicks — first arms, second bills, cost
  stated.

## 2026-07-19

- **Retention never ran. The predicate was fine — nothing called it.** 3 rows sat 12 days past the
  7-day window, yet a dry-run SELECT of the old predicate matched all 3. Real cause:
  `cleanupExpiredJobs()` was only called from `GET /api/jobs`, so rows were collected only when
  someone loaded `/jobs`. Fix: `worker.ts` calls it in `drain()`'s `finally`, so ingest is the
  heartbeat. **Lesson: when retention "doesn't work", check the caller before the query.** It also
  purges on age (`OR created_at < now-7 days`), covering jobs ClickUp never marks done — safe
  because their S3 objects expire on the same 7-day lifecycle.
- **Verified "Modal ~10× cheaper than Remotion-Lambda" with real numbers** (was an estimate):
  CloudWatch `Invocations`+`Duration` over 7 days + ffprobe on every `out.mp4` = 3,574,244 GB-s +
  ephemeral storage = **$59.92 for 42 renders / 533.8 output-min = $0.112/output-min** → a 2h story
  on Lambda ≈ **$13.50**, so "~$10/render" was understated; Modal ≈ $0.65. ~~(dead code)~~
  **Corollary: Remotion *on Modal* would have saved nothing — don't revisit.** Lambda `mem3072mb` =
  1.736 vCPU at $0.18/hr = $0.104/vCPU-hr vs Modal's `RATE_PER_CORE_HR = 0.10`; the ~20× win is
  ffmpeg-vs-headless-Chrome, not the host.
- ⚠️ **`RATE_PER_CORE_HR = 0.10` (`render-modal/modal_app.py:53`) is a hardcoded guess that ignores
  memory billing** (containers request `memory=4096`/`8192`), and every Modal dollar figure we quote
  rests on it.

## 2026-07-04

- **Hard SFW ban on all scene imagery** — this is YouTube; NSFW/gore must never render whatever the
  script or LLM produces. `SFW_NEGATIVE` (nudity, sexual, gore, blood, open wounds, corpses, graphic
  violence, horror) is prepended to `BASE_NEGATIVE` in `lib/jobs/scene-image.ts` so it lands on
  every image on both paths; a "SFW MANDATE (ABSOLUTE)" prompt rule (now in `agents/`) stops it
  upstream. The negative prompt is the last-resort gate.
- **Jobs gate the render on complete images and expose the finished video.** A job with failed
  images was still rendered, and the dashboard only offered "Open project" so nobody could tell a
  video already existed → re-renders. `worker.ts` re-attempts only still-missing scenes up to
  `GENERAL_RETRY_ROUNDS` (2) on a warm endpoint; if any is *still* missing it skips the render and
  parks the job in **`needs_images`** with the partial project saved. The download link resolves
  live from S3 (`GET /api/jobs` matches the checkpointed renderId against `listRecentRenders()`) —
  no queue-blocking wait, no `video_url` column — and a renderId already in `project_json` is reused
  so a restart can't pay twice.
- **Scene image gen retries with backoff.** On a cold Modal image-gen endpoint the whole first wave
  (images 0–9) died with `generation timed out after 300000ms` — containers still loading at the
  5-min poll deadline, 10/264 images lost. Fix: `POLL_TIMEOUT_MS` 5→6 min plus a 3-attempt
  submit→poll retry with exponential backoff (3s, 6s); by the retry the container is warm.
- **Ingest jobs resume instead of restarting.** A 247-scene job sat "stuck" for a day: every Railway
  restart/redeploy (or a dashboard visit running `requeueRunningJobs`) re-queued it and `processJob`
  re-ran the breakdown and regenerated every image from zero. Fix: checkpoint the `WorkflowExport`
  into `project_json` after the breakdown and every `SAVE_EVERY` (20) images, then reuse prior
  `scenes`/`storyboardScenes` and skip scenes that already have an `image_url`.
- **Scene images switched photoreal → digital painting.** Every prompt leads with
  `highly detailed digital painting, ` — the only art-style word — prepended at send time via
  `STYLE_PREFIX` in `scene-image.ts` so it holds regardless of LLM output; all photoreal / cinematic
  / camera / lens language was stripped. `style: "photo"` is unchanged.

## 2026-07-02

- **Removed Ken Burns zoom — scenes are static.** The `zoompan` per-frame x/y expressions rounded to
  integers each frame, giving visible shake; replaced with a static
  `scale=…:force_original_aspect_ratio=increase,crop` fill in `render-modal/modal_app.py`, dropping
  `ZOOM_LO/ZOOM_HI/DRIFT_PX`, `_zoom_expr` and the per-scene `zoom_in` flag. Redeploy Modal to
  apply.
- **Per-scene `negative_prompt`** (era-inaccurate items from the LLM) is appended to `BASE_NEGATIVE`
  and POSTed; deleted `lib/prompts/all-prompts.ts` (the suffix bolted onto every prompt).

## 2026-07-01

- ⚠️ **Removed AWS Lambda + Remotion entirely — rendering is Modal-only.** Deleted our three
  us-west-2 functions (`…mem10240mb-disk2048mb…`, `…mem10240mb-disk8192mb…`,
  `…mem3072mb-disk2048mb…`); **prod's two `…disk10240mb…` functions (4-0-451 + 4-0-462) share this
  AWS account and were left untouched — never touch them.** Also deleted `remotion/`,
  `remotion.config.ts`, `scripts/deploy-lambda.mjs` and the `@remotion/*` deps; `deploy:site` now
  only provisions the bucket.
- **Consolidated to our OWN bucket `sleep-stories-media` (us-west-2).** Renders had been landing in
  the *shared* `open-source-image-generation` bucket and audio in
  `remotionlambda-uswest2-sleepstories`. One bucket now holds `audio/` + `renders/<id>/<slug>.mp4`,
  public-read + CORS + 7-day lifecycle on both, via `deploy:site`. Modal writes through
  `SLEEP_RENDER_BUCKET` (default `sleep-stories-media`), the Next app reads `REMOTION_RENDER_BUCKET`
  — **keep the two in sync**. A bucket policy grants account `664991373499` write/list so Modal's
  creds can PUT regardless of IAM scoping.
- **Deleted dead render-input code — Modal composites everything.** `buildSleepVideoInput` and
  `planStoryText` still ran, but Modal recomputes all of it in Python and only the AI **title** was
  ever consumed; `story-text.ts` is now a title-only `deriveStoryTitle` (one 64-token call, was
  2048). Removed dead env keys `REMOTION_SITE_NAME`, `REMOTION_COMPOSITION_ID`,
  `REMOTION_LAMBDA_FUNCTION_NAME`, `REMOTION_SERVE_URL`.
- **Scene-engine LLM `gpt-4o` → `gpt-5.5-2026-04-23`** (`DEFAULT_MODEL`, `lib/ai/openai.ts`). **The
  GPT-5 family rejects custom `temperature` and takes `reasoning_effort` instead**, so
  `modelParams(temp)` adapts: gpt-5 → `reasoning_effort` (`low`, ~3.8× cheaper than medium; override
  `OPENAI_REASONING_EFFORT`), gpt-4o* → `temperature`. Also bumped the global-context pass
  `max_completion_tokens` 512 → 2000, because gpt-5 reasoning tokens count against that limit and
  were starving the summary to empty.

## 2026-06-29

- **Failed-image scenes are backfilled, not dropped.** Modal's `/render/start` used to filter out
  any scene missing `image_url`, shortening the video below the narration so `-shortest` clipped the
  tail of the audio; such a scene now reuses the previous scene's image (redeploy Modal).

## 2026-06-27

- **RENDER SWAP: Remotion-Lambda → Modal ffmpeg (~10× cheaper).** Lambda's 900s main-function
  timeout made ~2h videos a coin-flip at ~$10/render. New renderer is `render-modal/modal_app.py` at
  `https://avoajaugochukwu--sleep-render-web.modal.run` (~$1/render); same HTTP contract, so the
  swap was transport-only: `lib/render/modal.ts` (`startModalRender` + `fetchModalRenderProgress`,
  base URL via `RENDER_API_BASE`).

## 2026-06-26

- **UI image gen got the same bounded-pool treatment** — 10 workers plus an `AbortController` Cancel
  button, with the queue client-side so a refresh stops every not-yet-submitted scene.
- ~~(dead code)~~ **A warm-palette mandate fights historically cool/drab colours.** A "rich warm
  earth-toned palette" suffix force-warmed a WW2 Soviet greatcoat to RED; fixed with "keep colours
  true to life, not artificially warmed" plus an explicit period-colour rule. Period and place
  accuracy is why a global-context pre-pass exists at all — now `script_context`.

## 2026-06-25

- ~~(dead code)~~ **4K full-length was NOT viable on the Lambda topology — reverted to 1080p @
  24fps.** 4K made every chunk hit the **900s HARD timeout** (frames ~4× slower; chunks capped by
  Remotion's `MAX_FUNCTIONS_PER_RENDER = 200`, and 900s is the AWS max); 12fps cleared that but the
  single-Lambda final concat then died with `No space left on device` (it holds all 200 chunks plus
  the output in 8 GB `/tmp`), and **the disk couldn't grow, because 10240 MB (the max) renames the
  function to `…disk10240mb…` and collides with prod's name.** Only path to 4K is an off-Lambda
  render. Surviving live value: image gen `scale: 1` in `lib/jobs/scene-image.ts`.

## 2026-06-24

- **Worker image-gen timeouts (170/376 failed in one run).** It fired `Promise.all` over every
  scene, so ~376 simultaneous requests backed up Modal's container queue and tail images blew the
  5-min poll deadline. Now a bounded pool of `IMAGE_GEN_CONCURRENCY` (default 10).
- **Image generation moved to the self-hosted Modal image API**
  (`avoajaugochukwu--open-source-image-gen-web.modal.run`), async submit→poll: `POST /generate`
  (Bearer `IMAGE_API_TOKEN`) returns a `job_id`, then `GET /status/{job_id}` until `completed`. Why:
  own the model + cost (scale-to-zero), no third-party per-call billing. New env `IMAGE_API_TOKEN`
  (replaced `FAL_API_KEY`); cold starts ~40s. Model since changed to Krea-2. ~~(dead code)~~ Cheap
  enough that the 100-image pool cap (`MAX_GENERATED_IMAGES` + overflow reuse) was removed here —
  NOTE `CLAUDE.md` still describes a cap, reconcile.
- **Ingest jobs failed with "Audio duration could not be determined".** Our TTS output
  (audio-generation-service S3 `out.mp3`) is CBR MP3, "MPEG 2 Layer 3" @ 64 kbps, with **no
  Xing/Info duration header**, so `music-metadata`'s `format.duration` came back `undefined` and the
  job failed *after* generating all images (wasted spend). Fix: pass `{ duration: true }` to
  `parseWebStream` (forces a frame scan) in `lib/jobs/audio-duration.ts`, plus a bitrate×size
  fallback.
- **Added the Baserow/ClickUp ingest pipeline + `/jobs` dashboard**, mirroring footage-collector so
  one n8n/Baserow automation fans out to both apps: `POST /api/jobs/ingest` (header
  `x-ingest-secret`, body `{ taskId, listId?, script, audioUrl, name?, baserowRowId? }`, idempotent,
  `audioUrl` required here — FC left it optional); in-process worker that **needs a long-lived
  server**; ClickUp/Baserow writebacks all best-effort so a missing status label never blocks a
  render. ~~(dead code)~~ the store was a Turso table `sleep_jobs` (now Supabase Postgres; FC uses
  `footage_jobs`, no collision). New deps `pg`, `music-metadata`; new env `SUPABASE_DB_URL`,
  `INGEST_SECRET`, `CLICKUP_API`, `BASE_ROW_URL`, `BASEROW_EMAIL`, `BASEROW_PASSWORD`,
  `BASEROW_TABLE_ID`.

## 2026-06-15

- **"Start Over" didn't fully clear the session — old data came back.** The Zustand store persists
  to IndexedDB (`idb-keyval`, key `sleep-stories-session`) but `reset()` only did
  `set({ ...initialState })`, leaving the persisted entry intact, so the old session rehydrated on
  next load. Fix: `reset()` also `idbDel`s the entry, and the key is a shared `STORAGE_KEY` constant
  so the two can't drift.
- ~~(dead code)~~ **Long scripts collapsed to one scene per chunk (exactly 29 scenes = 29 chunks).**
  `DEFAULT_MODEL` was `claude-sonnet-4-20250514`, retired, so every per-chunk call got
  `404 not_found_error` — and `generateForChunk`'s `catch` silently fell back to "whole chunk = one
  scene". It looked like a chunking bug; it wasn't. **Lesson: a silent catch-fallback turns a dead
  model into plausible-looking output** — why the LLM fallbacks were deleted 2026-07-31.
- **Switched scene generation off Anthropic onto OpenAI** (`lib/ai/openai.ts`), using
  `response_format: { type: 'json_object' }` — more reliable than fence-stripping. Needs
  `OPENAI_API_KEY`; `lib/ai/anthropic.ts` has since been deleted.

## 2026-06-04

- **Ambience is a pick-one choice, not a toggle.** A `SOUND_EFFECTS` catalog keyed `fire` (vol 0.18)
  / `meditation` (vol 0.10), each carrying its own volume so the fuller meditation pad never
  overpowers narration. `soundEffect: "fire" | "meditation" | "none"` replaced the
  `enableSoundEffect` bool; `/api/render/start` validates the key against the catalog.
- **In-app mp3 narration upload via presigned PUT → S3.** `presignAudioUpload()` (`lib/aws/s3.ts`)
  mints a 10-min presigned PUT to `audio/<uuid>-<name>` in `REMOTION_RENDER_BUCKET` and the browser
  PUTs straight to S3. **Why presigned:** dodges the request-size ceiling for long mp3s and keeps
  the file off Railway. Objects are public-read; the `audio/` lifecycle expires them after 7 days.

## 2026-06-01

- **Audio URL load failed with a CORS error.** A public, reachable S3 URL showed "Could not load
  audio from that URL": the `<audio>` element had `crossOrigin = "anonymous"`, forcing a CORS check
  that buckets without an `Access-Control-Allow-Origin` header (e.g.
  `audio-generation-service-output`) fail. Removed `crossOrigin` in
  `components/workflow/audio-url-input.tsx` — we only read `duration`, which needs no CORS.
