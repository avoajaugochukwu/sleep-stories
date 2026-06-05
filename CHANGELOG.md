# Changelog

Notable changes to the Sleep Stories app — especially infra/config changes and
non-obvious bug fixes worth not relearning. Newest first. Dates are YYYY-MM-DD.

## 2026-06-04

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
