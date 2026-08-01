# Changelog

Infra/config changes and non-obvious bug fixes worth not relearning. Newest first, dates YYYY-MM-DD.

**~~(dead code)~~** marks an entry about a system that no longer exists, kept only for the lesson it
carries: Remotion + AWS Lambda (deleted 2026-07-01), Turso (now Supabase Postgres),
`no-gap-breakdown.ts` / `sleep-scene-prompt.ts` / `script-splitter.ts` / the `scene_splitter` agent
(deleted 2026-07-31).

**Current architecture: `CLAUDE.md`.** Rules for the Python layer: `agents/CLAUDE.md`.

## 2026-07-31 (later)

- **Scene timing now comes from Whisper word timestamps. Nothing estimates video
  length anymore.** `lib/align/` transcribes the narration on the existing
  `whisper-transcribe` Modal app (stable-ts + faster-whisper `small`, T4,
  `word_timestamps=True`, async `/v1/jobs` + poll because a 78-min file is ~3-5min
  and the sync endpoint invites proxy timeouts), runs **one global DTW** over the
  whole script vs the whole transcript, and slices each scene's span out of that
  single path. A scene's duration is the gap between the moments its first and
  next-first words are actually spoken. Called from `startRenderForScenes`, so the
  UI route and the ingest worker both get it and neither can render on a guess.
- **Global DTW, never per-scene.** remotion-test-2 learned this the hard way: its
  windowed per-scene version advanced a cursor and, on a weak match, stepped it by
  an *estimated* word count, so one bad patch of audio drifted every later window
  and cascaded through the video. A global path has no cursor to drift. Cost table
  ported unchanged (`MISMATCH 10 / DEL 5 / INS 5 / FILLER_INS 1`, free start+end).
- **`normalize.ts` is load-bearing, not tidying.** Whisper writes "1945" and "18th";
  a TTS script says "nineteen forty-five" and "eighteenth". Without the number-word
  folding, every date and casualty figure is a mismatch — and these are history
  scripts, so that is most of the alignment surface.
- **No fallback, deliberately.** Unmatched scenes throw and the job produces no
  video. Same call as deleting the `script_context` LLM fallbacks: a guessed timing
  ships a video whose images sit on the wrong sentences, and nothing downstream can
  see that. (remotion-test-2 *does* fall back to word-proportional timings here —
  we deliberately did not copy that.)
- **Transitions accounted for.** The renderer puts each crossfade *inside* the
  opening `CROSSFADE_SEC` of a clip (`xfade ... offset=0`), so a clip starting
  exactly on its first spoken word is still dissolving while that word plays. Every
  boundary moves half a crossfade earlier, landing the dissolve's midpoint on the
  sentence boundary. A uniform shift cancels in the differences, so only the ends
  move: scene 0 loses 0.6s, the last scene gains it, total still equals the audio.
  A scene that comes out shorter than the crossfade throws — ffmpeg's `xfade` needs
  `duration` seconds of both inputs.
- **The opening cuts faster: 20 scenes of 2 sentences, then 5.** More image changes
  while a viewer is still deciding to stay; longer holds once they have settled.
  `cutScript(script, sentencesPerScene, openingScenes, openingSentences)` —
  pass `openingScenes = 0` for a uniform cut (the offline checks do).
- **`WORDS_PER_SECOND` and every duration estimate are deleted.** `BreakdownScene`
  no longer carries `duration` at all; there is no audio at breakdown time, so any
  number there was a guess. Removed with it: `evenSceneDurations` (local only, never
  pushed) and `scaleScenesToAudio` (was live — see below).
- **`lib/remotion/` → `lib/render/`.** Nothing in it had touched Remotion since
  Lambda was deleted on 07-01; it now sits beside `modal.ts`, which is what it
  actually calls. `REMOTION_RENDER_BUCKET` keeps its name for now — renaming it
  means a Railway variable change, so it is deliberately left alone.
- ⚠️ **Two earlier fixes today are superseded.** `9bfaa17` (proportional rescale of
  word-count durations) was live in prod and is now gone. It made the *total* length
  right while still assuming a uniform reading pace, so internal boundaries drifted
  up to ~100s on a real 91-scene job. Kept in history only for the measurement.

- **Every video ever rendered was cut ~16% short — the clip clock never met the narration clock.**
  Scene `duration` is `words / WORDS_PER_SECOND` (2.5), computed at *breakdown* time, before the
  audio exists. The TTS voice actually reads at **2.09 w/s**. Nothing reconciled the two, and the
  finished video is only as long as its clips, so the tail of the story was silently dropped: job
  `868kk0481` measured 9808 words / 4684.8s audio, `sum(duration)` 3930s, output **3930.03s** — a
  78-minute read shipped as a 65-minute video, losing the last **12.6 minutes**. Both Somme renders
  have it too. `assemble` passes `-t audio_dur`, which is why this was invisible: ffmpeg simply runs
  out of video and stops, no error. Fixed with `scaleScenesToAudio()` in `cut-script.ts`, called from
  `startRenderForScenes` so the UI and worker paths both get it — word counts stay the source of
  *relative* scene length, measured audio becomes the absolute total. **Do not "fix" this by retuning
  `WORDS_PER_SECOND`**; a rescale is self-correcting when the voice changes, a constant is not.
  Four assertions in `npm run check:cut` (now 18).

- **Every scene after the first failed to render: `fps=` was dropped from the `[cur]` branch.**
  `Parsed_xfade_9 ... First input link main timebase (1/24) do not match the corresponding second
  input link xfade timebase (1/25)`. `-loop 1 -i img.png` is the **png_pipe** demuxer, which defaults
  to **25 fps**, so `[cur]` carried timebase 1/25 while `[prev]` — and every other branch — was
  forced to `fps=FPS` (24). `xfade` refuses the mismatch. Scene 0 has no `prev_url` and rendered
  fine; scenes 1..n all died, and `render_one.map()` propagates, so the job failed. Fix is
  `fps={FPS}` in the `[cur]` chain (`modal_app.py:273`), with a comment saying it is load-bearing.
- **The regression was 29 days old and only reached prod today.** It came in with `1731692`
  (07-02, "remove Ken Burns") — `zoompan` had been setting the frame rate, and deleting it deleted
  the timebase too. `modal deploy` is manual and nobody ran it between 07-02 and 07-31, so prod kept
  serving the pre-`1731692` app; the Somme renders on 07-29/07-30 succeeded on that stale copy.
  Today's redeploy (for the cost fix) shipped a month of untested commits at once. **The hazard runs
  both ways**: the earlier note warned that a clean-checkout redeploy would revert the deployed cost
  constant, but the bigger risk was git being *ahead* of Modal with a broken commit. Deploy Modal
  when you change it.
- **A failed render was reused forever, so retry silently no-opped** (`worker.ts:245`). The reuse
  branch was `if (priorRender?.renderId)` with no liveness check — and the checkpointed `status` is
  written once at creation and never updated, since job state is derived on read. A retry therefore
  re-adopted the dead render id and re-polled a corpse. Now polls Modal and only reuses when
  `fatalErrorEncountered` is false; a poll that throws also starts fresh.
- **`error=str(e)[:600]` truncated from the wrong end** (`modal_app.py:446`). `_sh` deliberately
  keeps `stderr[-1800:]` because ffmpeg's real error is the *last* line — then `[:600]` threw exactly
  that away and surfaced 600 chars of input banner. The whole diagnosis had to come from
  `modal app logs`. Now `[-600:]`.
- **`fc done` writeback works.** Job `868kk0481` came back `clickupStatus: "fc done"` — the status
  the user added to Midnight Mysteries is being applied. The earlier entry's warning is resolved.
- ⚠️ **`/api/jobs` shows "Rendering" for a render that has already failed.** The list route
  deliberately does not poll Modal (one call per row per poll), so it reported `state: "rendering"`
  while `/api/jobs/<id>`, which does poll, said `render_failed`. Unfixed — the queue page is the one
  people look at.

## 2026-07-31

- **The agent layer shipped and is live.** Merged to `main` (`ce9ff4a`), Railway built the Docker
  image successfully (deploy `9ff41300`) and `GET /api/agents/health` returns `runtime.ok true`,
  python 3.11.2, both agents importable. This retires two standing warnings: the image had never
  been built locally (no docker daemon), and Modal needed redeploying for the renamed overlay
  clips — both done.
- **Splitting the script needs no model at all, so `scene_splitter` is deleted.** v1 had the model
  copy each scene's text verbatim, then heal the copy, close coverage gaps, validate the reassembly
  and retry 4× — six mechanisms undoing damage the model could only do *because* it held the text.
  v2 asked for cut markers only and sliced the original string, making lossless coverage structural.
  v3 observed that **nothing downstream cares where a scene starts**, only that the scenes tile the
  script — images are per-scene, so a mid-thought cut costs nothing measurable. Now
  `lib/scene-engine/cut-script.ts` cuts after every 5th sentence (`SENTENCES_PER_SCENE`, the one
  knob), folds a one-sentence remainder back, and asserts `snippets.join('') === script`. No
  word-budget targeting either: sleep narration is even-paced. Covered by `npm run check:cut` (14
  assertions, no framework).
- **`script-splitter.ts` folded into `cut-script.ts`.** `compromise` stays and earns its place: a
  regex on `[.!?]\s` splits "Mr. Smith", "the U.S. Army" and "$4.50" mid-sentence, and a mid-sentence
  cut is a visible glitch. It supplies boundary *positions* only — each sentence is located
  forward-only in the original and only the offset kept, because `compromise` normalizes characters
  and **its strings must never become the snippet text**. The deleted file rebuilt each chunk as
  `sentences.join(' ')`, so its "byte-exact" contract was really against a rejoined copy.
- **`scene_director` takes every scene in ONE spawn and chunks internally** (`CHUNK_SIZE = 12`, 8 in
  flight). Batch size decides what a single model call sees, so it changes output and belongs beside
  the prompt — it was in `lib/`, two directories away. 12 is untested on a real job; if neighbouring
  scenes repeat imagery, drop back to 8.
- **`scene_director` fills an undirected scene from its nearest directed neighbour instead of failing
  the video.** After the per-chunk bank-and-repair loop it retries stragglers solo, then salvages
  what remains and logs `SALVAGED` (grep for it — rare is fine, common means `checks.py` needs work).
  Modal does the same a layer down. Still throws on zero scenes.
- **Python agents wired in; the old TypeScript scene path deleted.** `no-gap-breakdown.ts` renamed to
  `script-to-scenes.ts` ("no-gap" described an invariant, not the job) and gutted 282 → ~70 lines: a
  deterministic cut plus two bridge calls. **No A/B was run** — the decision was to wire in and
  refine from here. Deleted with it: `sleep-scene-prompt.ts` (prompts live in `agents/*/prompt.py`)
  and `lib/config/development.ts` (zero importers).
- **The LLM fallbacks are gone on purpose.** The old file caught a bad response and collapsed the
  chunk into one scene with an empty image prompt, so a failed call shipped a bad video instead of
  failing the job. `script_context` now throws; the cut cannot fail and the director salvages.
- **`overlayPack` threaded end to end.** `script_context` infers the genre and derives the pack
  (`agents/shared/genres.py`), `breakdownScript` returns it, `worker.ts` passes it to
  `startRenderForScenes`. Persisted as optional `overlayPack` on `WorkflowState` so a resumed job
  does not silently fall back to `fire`; not in the store's `partialize`, so a UI export renders with
  the default pack.
- **Jobs have their own URLs, and the queue says whether a video is rendering or rendered.** A job
  used to exist only as `/scenes?job=<taskId>` — no stable link, it raced the IndexedDB rehydrate on
  refresh, and render status was buried in `projectJson`. Added `app/jobs/[taskId]/page.tsx` +
  `components/jobs/job-detail.tsx`, read-only, never mounts the session store; `/scenes?job=` is
  still the edit path. State is derived in ONE place, `lib/jobs/render-state.ts`, called by both
  `/api/jobs` and `/api/jobs/[taskId]` so a row and its page cannot disagree — derived on read, never
  stored, since a stored copy goes stale the moment Modal finishes. Nine states; the two that matter
  are `rendering` and `rendered`, which the old UI collapsed into one **"Ready"** badge *after* the
  render had auto-started. `ready-tasks-badge.tsx` had the same bug and now counts derived
  `rendered`. Two deliberate asymmetries: the list route does **not** ask Modal for progress (one
  Modal call per row per poll) while the job page does; and "Open project to fix" appears only for
  `needs_images` / `needs_render`, since the editor is where the Render button lives.
- **Railway builds this service from a `Dockerfile`.** The `agents/` subprocesses need a system
  python in the image or every job fails in prod. Runtime unchanged (`npm run start`). The build gate
  runs every agent on an empty payload plus the offline checks, so a broken python layer fails the
  BUILD, not every job at runtime; `.dockerignore` keeps `.env*` out of image layers. `public/` is
  copied whole (~66MB) even though `public/overlays` and `public/sound-effects` are only read by
  `render-modal/modal_app.py` at Modal-deploy time — an exclusion would break silently the day a
  served asset lands there.
- **The ClickUp list this app writes to is named "Midnight Mysteries", not "Sleep Stories".**
  `lib/jobs/config.ts` had the wrong label on `901113872792`. Also recorded there:
  `901113798933 "Space Cluster"` is *footage-collector's* WW2 board despite the name, so **there is
  no space list** — a second genre rides the existing board via the ingest payload.
- **`STATUS_DONE` never applied on this board; `fc done` has since been added to it.** Default is
  `"fc done"`, and Midnight Mysteries used to have only `to do` / `in progress` / `complete` with no
  `CLICKUP_STATUS_DONE` override, so the writeback silently no-opped — it is best-effort and caught,
  and a job whose render started just stayed "in progress" until a human set it complete. The status
  now exists on the list, but **no job has exercised the writeback since**, and because the failure
  is swallowed a casing/spacing mismatch would look identical to success. Verify on the next job.
- **Modal render cost is now computed from Modal's real rates, CPU *and* memory.**
  `RATE_PER_CORE_HR = 0.10` was invented and ignored the memory line item, overstating every render
  by **~1.58×**. Modal bills the two separately, per second, on `max(request, actual)`:
  `$0.0000131/physical-core/sec` + `$0.00000222/GiB/sec` (https://modal.com/pricing). Replaced with
  `_container_usd(cores, mem_mb, sec)`, summed per container using each one's own request, so the
  scene workers and the assembler are costed on what they actually ask for. `SCENE_MEM_MB` /
  `ASSEMBLE_MEM_MB` now feed the `@app.function` decorators, so the billed request and the costed
  request cannot drift — the failure mode that produced the original guess. Two things worth
  knowing: the blended rate happens to be `$0.0631/core-hr` today only because both containers sit
  at 2 GiB per core, which is exactly why a single constant is the wrong shape; and the figure still
  **undercounts**, because Modal bills container uptime (cold start, image pull, ≤60s idle before
  scaledown) while `sec` measures function-body time. Deployed (`modal deploy`, all four functions,
  same URL).
- **Two renders for one Somme title were a double ingest, not a duplicate-render bug.** Jobs
  `868kj78jw` (07-30) and `868khnk1q` (07-29) hold byte-identical 12,597-word scripts. Ingest
  idempotency is keyed on `taskId`, so the same script arriving under two ClickUp tasks correctly
  creates two jobs and two renders. Look upstream at the automation, not at the queue.
- **Image generation is Krea-2 via Modal only — this app has never called gpt-image.** Benchmarked
  Krea-2 against `gpt-image-2` over 30 scenes from 3 scripts (space / Odyssey / Somme); gpt-image-2
  read prompts more faithfully in spot checks. **Not switched**, because the swap is not a config
  change: `images.generate` returns b64, so scene images would need uploading to S3 instead of
  storing the URL the Modal endpoint hands back, and the director's per-scene `negative_prompt` would
  be dropped (gpt-image has no such parameter, and `SFW_NEGATIVE` is the last-resort gate).
- **If gpt-image is ever wired in, start at `gpt-image-2`.** `gpt-image-1` is deprecated (shutdown
  **2026-10-23**), costs more at every tier ($0.016 vs $0.0032 for a low-quality landscape) and has
  **no true 16:9** — its largest landscape is `1536x1024` (3:2), needing a crop. gpt-image-2 accepts
  any size whose edges are multiples of 16, so **`1920x1080` is INVALID**; use `1280x720`
  (~$0.0032/image, ≈$0.32 per 100-image video) or `2048x1152`. The sibling `homestead` app already
  runs `gpt-image-2` / `1280x720` / `low`.

## 2026-07-30

- **Added the Python agent layer under `agents/`** (`script_context`, ~~(dead code)~~
  `scene_splitter`, `scene_director`) + `lib/agents/bridge.ts` and `GET /api/agents/health`.
  Contract copied from the sibling military-video repo: JSON on stdin, JSON on stdout, logs on
  stderr, **no fallback**. Motivation was a second genre (space): the old single prompt owned five
  decisions at once and its `GLOBAL_CONTEXT_PROMPT` pinned an exact historical year — wrong for a
  cosmos script. Genre now lives in `agents/scene_director/prompt.py` + `agents/shared/genres.py`;
  `lib/` never branches on it.
- ~~(dead code)~~ **Two bugs the Python port found in the TS original:** (1) it located each snippet
  with `indexOf(snippet)` — always from position 0 — so on repeated narration the second occurrence
  resolved to the first and computed gaps were garbage (use a running cursor); (2) it skipped
  whitespace-only gaps (`if (gap.trim())`), fatal once byte-exact reassembly is the contract, because
  the model drops the inter-sentence space on nearly every call.
- **A prebaked job's render was invisible in the UI, so the Render button invited you to pay for a
  second copy of a multi-hour video.** The worker checkpoints the `RenderJob` into `project_json`, so
  a hydrated project reaches `/render` with `renders` already in the store — `RenderPanel` polled
  them and wrote progress back but never displayed them, and the only visible list was the 7-day S3
  history, empty until the MP4 lands. Fix: a per-render banner (rendering % / done + link / failed),
  and a second take needs two clicks — first arms, second bills, cost stated.

## 2026-07-19

- **Retention never ran. The predicate was fine — nothing called it.** 3 rows sat 12 days past the
  7-day window, yet a dry-run SELECT of the old predicate matched all 3. Real cause:
  `cleanupExpiredJobs()` was only called from `GET /api/jobs`, so rows were collected only when
  someone loaded `/jobs`. Fix: `worker.ts` calls it in `drain()`'s `finally`, so ingest is the
  heartbeat. **Lesson: when retention "doesn't work", check the caller before the query.** It also
  purges on age (`OR created_at < now-7 days`), covering jobs ClickUp never marks done — safe because
  their S3 objects expire on the same 7-day lifecycle.
- **Verified "Modal ~10× cheaper than Remotion-Lambda" with real numbers** (was an estimate):
  CloudWatch `Invocations`+`Duration` over 7 days + ffprobe on every `out.mp4` = **$59.92 for 42
  renders / 533.8 output-min = $0.112/output-min** → a 2h story on Lambda ≈ **$13.50** (so
  "~$10/render" was understated); Modal ≈ $0.65. ~~(dead code)~~ **Corollary: Remotion *on Modal*
  would have saved nothing — don't revisit.** Lambda `mem3072mb` = 1.736 vCPU at $0.104/vCPU-hr vs
  Modal's `RATE_PER_CORE_HR = 0.10`; the ~20× win is ffmpeg-vs-headless-Chrome, not the host.
- **`RATE_PER_CORE_HR = 0.10` was a hardcoded guess ignoring memory billing** — every Modal dollar
  figure rested on it. Fixed 2026-07-31 (see that entry); the ~10× Lambda comparison above survives
  it, since correcting the rate moves Modal *down*.

## 2026-07-04

- **Hard SFW ban on all scene imagery** — this is YouTube; NSFW/gore must never render whatever the
  script or LLM produces. `SFW_NEGATIVE` is prepended to `BASE_NEGATIVE` in `lib/jobs/scene-image.ts`
  so it lands on every image on both paths; a "SFW MANDATE (ABSOLUTE)" prompt rule (now in `agents/`)
  stops it upstream. The negative prompt is the last-resort gate.
- **Jobs gate the render on complete images and expose the finished video.** A job with failed images
  was still rendered, and the dashboard only offered "Open project" so nobody could tell a video
  already existed → re-renders. `worker.ts` re-attempts only still-missing scenes up to
  `GENERAL_RETRY_ROUNDS` (2) on a warm endpoint; if any is *still* missing it skips the render and
  parks the job in **`needs_images`** with the partial project saved. The download link resolves live
  from S3 (matching the checkpointed renderId against `listRecentRenders()`) — no queue-blocking
  wait, no `video_url` column — and a renderId already in `project_json` is reused so a restart can't
  pay twice.
- **Scene image gen retries with backoff.** On a cold Modal image-gen endpoint the whole first wave
  (images 0–9) died with `generation timed out after 300000ms` — containers still loading at the
  5-min poll deadline, 10/264 images lost. Fix: `POLL_TIMEOUT_MS` 5→6 min plus a 3-attempt
  submit→poll retry with exponential backoff (3s, 6s); by the retry the container is warm.
- **Ingest jobs resume instead of restarting.** A 247-scene job sat "stuck" for a day: every Railway
  restart/redeploy (or a dashboard visit running `requeueRunningJobs`) re-queued it and `processJob`
  re-ran the breakdown and regenerated every image from zero. Fix: checkpoint the `WorkflowExport`
  after the breakdown and every `SAVE_EVERY` (20) images, then reuse prior `scenes`/
  `storyboardScenes` and skip scenes that already have an `image_url`.
- **Scene images switched photoreal → digital painting.** Every prompt leads with
  `highly detailed digital painting, ` — the only art-style word — prepended at send time via
  `STYLE_PREFIX` so it holds regardless of LLM output; all photoreal / camera / lens language was
  stripped. `style: "photo"` is unchanged.

## 2026-07-02

- **Removed Ken Burns zoom — scenes are static.** The `zoompan` per-frame x/y expressions rounded to
  integers each frame, giving visible shake; replaced with a static
  `scale=…:force_original_aspect_ratio=increase,crop` fill, dropping `ZOOM_LO/ZOOM_HI/DRIFT_PX`,
  `_zoom_expr` and the per-scene `zoom_in` flag.
- **Per-scene `negative_prompt`** (era-inaccurate items from the LLM) is appended to `BASE_NEGATIVE`
  and POSTed; deleted `lib/prompts/all-prompts.ts` (the suffix bolted onto every prompt).

## 2026-07-01

- ⚠️ **Removed AWS Lambda + Remotion entirely — rendering is Modal-only.** Deleted our three
  us-west-2 functions; **prod's two `…disk10240mb…` functions (4-0-451 + 4-0-462) share this AWS
  account and were left untouched — never touch them.** Also deleted `remotion/`,
  `remotion.config.ts`, `scripts/deploy-lambda.mjs` and the `@remotion/*` deps; `deploy:site` now
  only provisions the bucket.
- **Consolidated to our OWN bucket `sleep-stories-media` (us-west-2).** Renders had been landing in
  the *shared* `open-source-image-generation` bucket and audio in
  `remotionlambda-uswest2-sleepstories`. One bucket now holds `audio/` + `renders/<id>/<slug>.mp4`,
  public-read + CORS + 7-day lifecycle on both, via `deploy:site`. Modal writes through
  `SLEEP_RENDER_BUCKET`, the Next app reads `REMOTION_RENDER_BUCKET` — **keep the two in sync**. A
  bucket policy grants account `664991373499` write/list so Modal's creds can PUT regardless of IAM
  scoping.
- **Deleted dead render-input code — Modal composites everything.** `buildSleepVideoInput` and
  `planStoryText` still ran, but Modal recomputes all of it in Python and only the AI **title** was
  ever consumed; `story-text.ts` is now a title-only `deriveStoryTitle` (one 64-token call, was
  2048). Removed dead env keys `REMOTION_SITE_NAME`, `REMOTION_COMPOSITION_ID`,
  `REMOTION_LAMBDA_FUNCTION_NAME`, `REMOTION_SERVE_URL`.
- **Scene-engine LLM moved to the GPT-5 family** (`DEFAULT_MODEL`, `lib/ai/openai.ts`; today's value
  is `gpt-5-mini`, matched by `AGENT_MODEL` in `agents/shared/config.py` so the Python agents and the
  TypeScript title call never diverge). **The GPT-5 family rejects custom `temperature` and takes
  `reasoning_effort` instead**, so `modelParams(temp)` adapts: gpt-5 → `reasoning_effort` (`low`,
  ~3.8× cheaper than medium; override `OPENAI_REASONING_EFFORT`), gpt-4o* → `temperature`. Also
  bumped the global-context pass `max_completion_tokens` 512 → 2000, because gpt-5 reasoning tokens
  count against that limit and were starving the summary to empty.

## 2026-06-29

- **Failed-image scenes are backfilled, not dropped.** Modal's `/render/start` used to filter out any
  scene missing `image_url`, shortening the video below the narration so `-shortest` clipped the tail
  of the audio; such a scene now reuses the previous scene's image.

## 2026-06-27

- **RENDER SWAP: Remotion-Lambda → Modal ffmpeg (~10× cheaper).** Lambda's 900s main-function timeout
  made ~2h videos a coin-flip at ~$10/render. New renderer is `render-modal/modal_app.py` at
  `https://avoajaugochukwu--sleep-render-web.modal.run` (~$1/render); same HTTP contract, so the swap
  was transport-only: `lib/render/modal.ts`, base URL via `RENDER_API_BASE`.

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
  single-Lambda final concat then died with `No space left on device` (all 200 chunks plus the output
  in 8 GB `/tmp`), and **the disk couldn't grow, because 10240 MB (the max) renames the function to
  `…disk10240mb…` and collides with prod's name.** Surviving live value: image gen `scale: 1`.

## 2026-06-24

- **Worker image-gen timeouts (170/376 failed in one run).** It fired `Promise.all` over every scene,
  so ~376 simultaneous requests backed up Modal's container queue and tail images blew the 5-min poll
  deadline. Now a bounded pool of `IMAGE_GEN_CONCURRENCY` (default 10).
- **Image generation moved to the self-hosted Modal image API**
  (`avoajaugochukwu--open-source-image-gen-web.modal.run`), async submit→poll: `POST /generate`
  (Bearer `IMAGE_API_TOKEN`) returns a `job_id`, then `GET /status/{job_id}` until `completed`. Why:
  own the model + cost (scale-to-zero), no third-party per-call billing. New env `IMAGE_API_TOKEN`
  (replaced `FAL_API_KEY`); cold starts ~40s. Model since changed to Krea-2. Cheap enough that the
  100-image pool cap (`MAX_GENERATED_IMAGES` + overflow reuse) was removed.
- **Ingest jobs failed with "Audio duration could not be determined".** Our TTS output (CBR MP3,
  "MPEG 2 Layer 3" @ 64 kbps) carries **no Xing/Info duration header**, so `music-metadata`'s
  `format.duration` came back `undefined` and the job failed *after* generating all images (wasted
  spend). Fix: pass `{ duration: true }` to `parseWebStream` (forces a frame scan) in
  `lib/jobs/audio-duration.ts`, plus a bitrate×size fallback.
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

- **"Start Over" didn't fully clear the session — old data came back.** The Zustand store persists to
  IndexedDB (`idb-keyval`, key `sleep-stories-session`) but `reset()` only did
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
- **In-app mp3 narration upload via presigned PUT → S3.** `presignAudioUpload()` mints a 10-min
  presigned PUT to `audio/<uuid>-<name>` in `REMOTION_RENDER_BUCKET` and the browser PUTs straight to
  S3. **Why presigned:** dodges the request-size ceiling for long mp3s and keeps the file off
  Railway. Objects are public-read; the `audio/` lifecycle expires them after 7 days.

## 2026-06-01

- **Audio URL load failed with a CORS error.** A public, reachable S3 URL showed "Could not load
  audio from that URL": the `<audio>` element had `crossOrigin = "anonymous"`, forcing a CORS check
  that buckets without an `Access-Control-Allow-Origin` header fail. Removed `crossOrigin` in
  `components/workflow/audio-url-input.tsx` — we only read `duration`, which needs no CORS.
