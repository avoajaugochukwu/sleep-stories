# Changelog

Notable changes to the Sleep Stories app — especially infra/config changes and
non-obvious bug fixes worth not relearning. Newest first. Dates are YYYY-MM-DD.

## 2026-06-24

- **Changed: image generation now uses the self-hosted Modal image API
  (`avoajaugochukwu--open-source-image-gen-web.modal.run`, Z-Image) instead of
  fal/Grok Imagine.** `lib/jobs/scene-image.ts` rewritten to the async
  submit→poll contract: `POST /generate` (Bearer `IMAGE_API_TOKEN`) returns a
  `job_id`, then `GET /status/{job_id}` polls until `completed`. Avoidances moved
  from prompt text into a real `negative_prompt`; quality `fast`, aspect `16:9`.
  Why: own the model + cost (scale-to-zero), no third-party per-call billing.
  New env: `IMAGE_API_TOKEN` (replaces `FAL_API_KEY`). Note cold starts ~40s
  (5-min poll timeout). `@fal-ai/client` is now unused.

- **Fixed: ingest jobs failed at the audio step with "Audio duration could not
  be determined".** Our TTS output (audio-generation-service S3 `out.mp3`) is
  CBR MP3, codec "MPEG 2 Layer 3" @ 64 kbps, with **no Xing/Info duration
  header**, so `music-metadata`'s `format.duration` came back `undefined` and the
  job failed *after* generating all images (wasted spend). Fix: pass
  `{ duration: true }` to `parseWebStream` (forces a frame scan; streams frame by
  frame, no full-file buffering) in `lib/jobs/audio-duration.ts`, plus a
  bitrate×size fallback. Verified against the real file → 8085.79s (~2h15m).

- **Added a full Baserow/ClickUp ingest pipeline + jobs dashboard, mirroring
  footage-collector end-to-end.** A single n8n/Baserow automation can now fan
  out to both apps with the same contract.
  - **Ingest:** `POST /api/jobs/ingest` (header `x-ingest-secret`, body
    `{ taskId, listId?, script, audioUrl, name?, baserowRowId? }`, response
    `{ ok, taskId, created, status, url }`). Idempotent. `audioUrl` is required
    here (the render needs it; FC left it optional).
  - **Worker** (`lib/jobs/worker.ts`, in-process, long-lived server only): runs
    the whole pipeline headless — `breakdownScript` → image pool (cap
    `MAX_GENERATED_IMAGES`, overflow reuse) → audio duration → Lambda render →
    stores the finished `WorkflowExport` as `project_json`. Flips ClickUp status
    (in-progress → done) and flags the Baserow row `video_processed`. Supports
    cooperative cancel. All ClickUp/Baserow writebacks are best-effort (caught),
    so a missing status label or wrong row never blocks the render.
  - **Store:** new Turso table `sleep_jobs` in the shared FC database (FC uses
    `footage_jobs` — no collision). FC-parity columns: clickup status tracking,
    `hidden`, 7-day retention after ClickUp marks done.
  - **Dashboard:** `/jobs` page + `JobsPanel` (queued/running/ready/failed/
    cancelled, grouped by channel, retry/cancel/open, 5s poll), a header **Jobs**
    link with a "ready" count badge, and `GET /api/jobs` (re-checks ClickUp,
    hides complete/deleted tasks). Per-job control via `POST /api/jobs/[taskId]`
    `{ action: retry|cancel|delete }`.
  - **UI hydration:** open `/scenes?job=<taskId>` and `JobHydrator` polls +
    loads the prebaked `WorkflowExport` via the existing import path — images and
    audio persist for re-render and thumbnail picking.
  - **Boards:** `lib/jobs/config.ts` maps ClickUp list `901113872792`
    ("Sleep Stories") → label. Status labels default to `"in progress"`/
    `"fc done"`/`"complete"`, overridable via `CLICKUP_STATUS_*` env.
  - **New deps:** `@libsql/client` (Turso, same as FC), `music-metadata` (read
    audio duration server-side — the browser uses an `<audio>` element the
    worker has no access to).
  - **New env (copied from FC's `.env.local`):** `TURSO_DATABASE_URL`,
    `TURSO_AUTH_TOKEN`, `INGEST_SECRET`, `CLICKUP_API`, `BASE_ROW_URL`,
    `BASEROW_EMAIL`, `BASEROW_PASSWORD`, `BASEROW_TABLE_ID`, plus `RAILWAY_*`.
  - **Refactor (no behaviour change):** factored shared cores into
    `lib/remotion/start-render.ts` and `lib/jobs/scene-image.ts`; the render-start
    and scene-image routes now call them. `clickup.ts`/`baserow.ts` copied
    verbatim from FC.
  - *The worker needs a long-lived server (Railway); it won't drain on serverless.*

- **Image aesthetic changed from "muted dark" to "dark with a touch of neon".**
  Mostly-dark, low-key frame with ONE or TWO small restrained neon accents in a
  SINGLE color per scene, the color *varied scene-to-scene* (green, orange,
  amber, teal, cyan, pink, blue, violet) and tied to a named in-scene glow
  source (lantern, fireflies, clock, neon sign). The persona layer
  (`lib/scene-engine/sleep-scene-prompt.ts`) picks the single color; the suffix
  (`lib/prompts/all-prompts.ts`) only enforces restraint + "no confetti / no
  disco / no extra colors". Iteration notes (so we don't relearn): a single
  blue/purple "burst" was too monochrome; listing *all* neon colors in the
  per-image suffix made the model cram every hue into one frame → multicolor
  confetti; the fix was one-color-per-scene from the persona + a color-free
  suffix. Note `NEGATIVE_PROMPT_SLEEP` confetti blocks are inert on Z-Image
  (empty-negative CFG ignores negatives) — steering is positive-prompt only.

- **Z-Image quality fix: shortened `IMAGE_GENERATION_SUFFIX` from a ~1100-char
  comma-tag/negation soup to one natural-language sentence.** Symptom: Z-Image
  renders looked muddy/washed-out and "not comparable to online" — suspected a
  LoRA. There is NO LoRA on the Z-Image backend (`app/backends/zimage.py` runs
  raw `ZImagePipeline`; the only LoRA is on the inactive Qwen fallback). A
  same-seed A/B proved the cause: a clean short prompt produced sharp, well-lit
  results; the same subject + the long suffix produced a muddy frame and even
  rendered the words "no confetti" as a literal green dot. Z-Image is a
  natural-language follower — Midjourney-style tag stacks ("atmospheric haze,
  soft focus background, mostly dark frame, 8k") and "no X" negations degrade
  it. Settings were fine (Base wants guidance 3–5 / 28–50 steps; we run 5.0/30).
  Side effect: dropping the "no borders" negation occasionally lets a thin matte
  border appear — acceptable, croppable.
  `NEGATIVE_PROMPT_SLEEP` dropped `oversaturated` and `garish neon` (they
  suppressed the new look) and added `blown-out highlights`. The scene persona
  layer (`lib/scene-engine/sleep-scene-prompt.ts`) color rule now asks each
  `visual_context` for ONE *motivated* neon glow source (neon sign, glowing
  window, bioluminescence, aurora) so the color reads as part of the scene, not
  pasted on. Runtime-only strings (analyze + scene-image API routes) — no
  Lambda/site redeploy needed.

## 2026-06-15

- **Script editor on the scenes page is now always visible (no "Change script"
  step).** It was gated by a local `isScriptSet` toggle: once a script existed
  the editor was hidden behind the scene breakdown, and you had to click "Change
  script" to get it back — awkward when adding audio first or editing. Now the
  audio card and script editor always render (add them in any order), the
  breakdown shows below once a script is set, and submitting a *changed* script
  clears the old scenes/images and re-runs (keyed on `generated_at`); an
  unchanged submit is a no-op (button disabled). The editor seeds once from the
  store after hydration. `app/scenes/page.tsx` only.
- **"Start Over" didn't fully clear the session — old data came back.** The
  Zustand store persists to IndexedDB (`idb-keyval`, key `sleep-stories-session`),
  but `reset()` only did `set({ ...initialState })`, clearing in-memory state
  while leaving the persisted entry intact — so the old session rehydrated on the
  next load (and could win the race against an in-flight hydration right after a
  reset). Fix: `reset()` now also `idbDel`s the persisted entry, and the storage
  key is a shared `STORAGE_KEY` constant so the persist config and reset can't
  drift. Server/UI logic only — no redeploy.
- **Long scripts collapsed to one scene per chunk (e.g. exactly 29 scenes for a
  20,194-word / 1,149-sentence script = exactly 29 forty-sentence chunks).** Root
  cause: `DEFAULT_MODEL` was `claude-sonnet-4-20250514`, which the Anthropic API
  now returns `404 not_found_error` for (the model ID was retired). Every
  per-chunk `messages.create` call threw, and `generateForChunk`'s `catch`
  silently falls back to "whole chunk = one scene" — so chunk count == scene
  count. It *used* to work because the model existed. The symptom looked like a
  chunking/over-grouping problem but was not.
- **Switched scene generation off Anthropic onto OpenAI GPT-4o** (per request).
  New `lib/ai/openai.ts` (client + `DEFAULT_MODEL = 'gpt-4o'`); `no-gap-breakdown.ts`
  and `story-text.ts` now call `openai.chat.completions.create` with
  `response_format: { type: 'json_object' }` (more reliable JSON than fence-stripping)
  and `max_completion_tokens`. Verified on the real API: a 40-sentence chunk →
  14 scenes, 14/14 exact-substring anchored. `lib/ai/anthropic.ts` is now unused.
  Requires `OPENAI_API_KEY` in `.env.local` (already present).
- Kept `DEFAULT_SENTENCES_PER_CHUNK = 40` (an interim drop to 10 was reverted —
  the bug was never chunk size, and GPT-4o is slower ~19s/call so 40 keeps the
  analyze route's ~29 calls well under the 300s budget; 10 would be ~115 calls
  and risk a timeout). Also added a `finish_reason === 'length'` warning so a
  truncated chunk is logged instead of silently collapsing. Server/UI logic only
  (ships via Railway, not the Lambda bundle) — no redeploy needed.

## 2026-06-04

- **Added a second ambient bed (meditation) + per-bed volume; ambience is now a
  pick-one choice, not a toggle.** `build-input.ts` replaces `FIRE_SOUND_EFFECT`
  with a `SOUND_EFFECTS` catalog keyed `fire` (vol 0.18) / `meditation` (vol
  0.10) — each carries its own volume so the fuller meditation pad sits lower and
  never overpowers the narration. `buildSleepVideoInput` now takes
  `soundEffect: "fire" | "meditation" | "none"` (was the `enableSoundEffect`
  bool); `/api/render/start` validates the key against the catalog; the render
  panel swaps the checkbox for a radio group (Fire / Meditation / Off, Fire
  default). New file `public/sound-effects/quietphase-meditation-ambient-484356.mp3`.
  **Why deploy:site:** the new mp3 must be in the bundled `public/` for
  `staticFile()` to resolve it on Lambda (server/UI logic itself ships via
  Railway).

- **Added in-app mp3 narration upload (presigned PUT → S3), for quick test
  renders.** You no longer have to upload a voiceover to S3 by hand and paste the
  URL: the narration step now has an "Upload mp3" button. `lib/aws/s3.ts` gains
  `presignAudioUpload()` (uses the already-installed
  `@aws-sdk/s3-request-presigner`) which mints a 10-min presigned PUT to
  `audio/<uuid>-<name>` in `REMOTION_RENDER_BUCKET`; new route
  `app/api/audio/upload-url` returns it. The browser PUTs the file straight to S3
  (CORS for PUT already set in `deploy-site.mjs`, so the file never streams
  through Railway / hits its body-size limit), reads the duration locally from the
  File, and sets it as the narration. **Why presigned PUT, not a server upload:**
  avoids the request-size ceiling for long mp3s. The bucket policy already makes
  every object public-read, so Lambda fetches the `publicUrl` with no presigning;
  the `audio/` lifecycle rule expires it after 7 days. App-code only (ships via
  Railway) — no `deploy:site` needed.

- **Added a looping fire-crackling ambience under the narration.** New
  `SleepSoundEffect` type + optional `soundEffect` prop on `SleepVideoInputProps`;
  `SleepStory.tsx` mixes it via `<Audio src={staticFile(...)} loop volume={…}>`
  beneath the narration `<Audio>`. The clip lives in
  `public/sound-effects/soundreality-fire-ambience-528618.mp3` (bundled into the
  deployed site, so `staticFile()` resolves it on Lambda; `loop` repeats it to
  fill any duration). `build-input.ts` exposes `FIRE_SOUND_EFFECT` (volume 0.18)
  and takes `enableSoundEffect` (default true); the render panel has a "Fire
  crackling ambience" checkbox (on by default) that posts `enableSoundEffect` to
  `/api/render/start`. **Why off matters:** skipping it keeps quick test renders
  light. `remotion/**` + `lib/remotion/types.ts` change → required
  `npm run deploy:site` (Lambda renders the deployed bundle).

## 2026-06-01

- **Added `crf: 26` to the render — fixes ENOSPC at the final concat/mux.** With
  Remotion's default h264 CRF (~18) the encode ran ~6 Mbps; a 2.2h story = ~5.7 GB
  of chunks. The final stitch runs on ONE Lambda and holds ALL 200 chunks +
  audio + the growing output in `/tmp` simultaneously (~11.5 GB needed), so it
  overflowed even the 8 GB disk during `ffmpeg` mux (`No space left on device`,
  exit 228). Bumping disk can't fix it (10 GB collides with prod's name, and even
  that's < 11.5 GB). CRF 26 ≈ ~2 Mbps shrinks chunks+output ~3× (fits well under
  8 GB), cuts cost, and yields a sane file size; grain/fog overlays dither any
  banding. In `lib/remotion/lambda.ts` (server-side, ships via Railway — no
  `deploy:site`/`deploy:lambda`). Lower the CRF number for higher quality.

- **Fixed `inputRange must be strictly monotonically increasing [0,51,51,102]`
  render crash.** Fade envelopes in `remotion/effects/OverlayVideos.tsx` and
  `remotion/text/StoryCaptions.tsx` built a 4-point interpolate range
  `[0, fade, dur-fade, dur]`. When a clip's duration was even and `fadeFrames >=
  dur/2`, `fade = floor(dur/2)` made the two middle points equal (e.g. dur 102,
  fade 51), which Remotion rejects. Triggered by the final short overlay sliver
  from `scheduleOverlays`. Fix: clamp `fade = min(fadeFrames, floor((dur-1)/2))`
  so the range is always strictly increasing. `remotion/**` change → required
  `npm run deploy:site` (Lambda renders the deployed bundle).

- **`MAX_CHUNKS` stays 200 — Remotion hard-caps functions at 200.** Briefly
  tried 400 for timeout headroom; Remotion rejected the render outright with
  "Too many functions: This render would cause 400 functions to spawn. We limit
  this amount to 200." The cap is a Remotion limit, independent of our 1500 AWS
  account concurrency (verified via `GetAccountSettings`) — so 200 is a ceiling,
  not a tunable. Consequence: for very long stories (a ~2.2h render = ~193k
  frames → ~965 frames/chunk) the only levers left against the 900s/chunk limit
  are fps/resolution, since memory (10240 MB) and timeout (900s) are already at
  AWS maximums.

- **Lambda render disk 2048 MB → 8192 MB.** Renders failed with
  `ENOSPC: no space left on device` while writing to `/tmp`. Long sleep renders
  store the source narration (can be ~200 MB) plus a multi-hour 1080p output on
  disk, which overflowed 2 GB. Bumped `diskSizeInMb` in
  `scripts/deploy-lambda.mjs` and redeployed. New function name
  `remotion-render-4-0-451-mem10240mb-disk8192mb-900sec` (still distinct from
  prod's `…disk10240mb…`); updated `REMOTION_LAMBDA_FUNCTION_NAME` in
  `.env.local`. Old `…disk2048mb…` function left in place, unused.

- **Audio URL load failed with a CORS error.** Pasting an S3 audio URL showed
  "Could not load audio from that URL". The URL was public and reachable; the
  `<audio>` element had `crossOrigin = "anonymous"`, which forced a CORS check
  that buckets without an `Access-Control-Allow-Origin` header (e.g.
  `audio-generation-service-output`) fail. Removed `crossOrigin` in
  `components/workflow/audio-url-input.tsx` — we only read `duration`, which
  doesn't need CORS.
