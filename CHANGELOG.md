# Changelog

Notable changes to the Sleep Stories app — especially infra/config changes and
non-obvious bug fixes worth not relearning. Newest first. Dates are YYYY-MM-DD.

## 2026-06-01

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
