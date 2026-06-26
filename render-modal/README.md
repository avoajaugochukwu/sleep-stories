# render-modal — cheap ffmpeg renderer (drop-in for Remotion-Lambda)

Renders the sleep-story video on Modal with ffmpeg instead of Remotion on Lambda. ~10× cheaper
(~$1 vs ~$10 for the full 135-min video) and a full port of the Remotion composition.

## What it renders (faithful port of remotion/SleepStory.tsx)
Stacking order, all baked per-scene from the scene's known global frame offset:
1. **Ken Burns** — scale 1.05↔1.16 (alt in/out per scene) + 18px vertical drift (`KenBurnsImage`)
2. **1.2s crossfade** between scenes (xfade from prev image)
3. **Rotating overlay pool** — all 6 clips, screen blend, 45–150s appearances, gaps, fades, slowed (`OverlayVideos` + `scheduleOverlays`)
4. **Stars** — faint star field (`Stars`)
5. **Grain + vignette** (`GrainVignette`)
6. **Captions** — bottom-left serif phrases every 3–5 min (`StoryCaptions` + `story-text`)
7. **Title card** — opening EB Garamond title, fades (`TitleCard`)
8. Narration + looped ambience (fire crackling default)

**Critical correctness note:** every `blend` runs in **RGB** (`format=gbrp`), never yuv420p.
Screen/multiply on YUV chroma planes shifts hue (red overlay→purple, blue stars→green). The
browser composites in RGB; so must ffmpeg. This was the cause of an earlier purple wash.

## Shared assets
Overlays + ambience read from `public/overlays/` + `public/sound-effects/` (Remotion's source).
Fonts (EB Garamond) + vignette/star PNGs live in `render-modal/assets/` (regenerate the PNGs
with the snippet in git history if geometry changes). All bundled into the image on deploy.

Stars are a pre-rendered 60s seamless twinkle loop (`assets/stars.mp4`, Remotion's sine math
baked in), seeked by global time so phase is continuous across scenes. Regenerate with the
numpy snippet in git history if you change star count/positions.

ponytail: the 3%-over-2h star field drift is dropped (~32px over 2h, imperceptible). Caption
text uses the in-repo `toGentleLine` fallback, not the OpenAI phrasing pass; timing, position
and font are exact. Wire `lib/scene-engine/story-text`'s LLM call for AI-phrased captions.

## Deploy
```
modal deploy render-modal/modal_app.py     # from app root; prints the web URL
```
Uses Modal secret `open-source-image-gen-secrets` (AWS creds + public bucket). Output lands at
`generations/sleep-stories/<id>/<slug>.mp4`. The bucket policy makes that prefix public-read
(statement `PublicReadSleepStories`, added once), so `outputFile` is a plain unsigned URL —
same S3 style as the image-gen service, no presigning. Each scene renders in its own
container (`render_one`, fanned out via `.map()`); `assemble` concats + muxes.

## HTTP contract (same as the Lambda path)
`POST {webURL}/render/start`
```json
{ "scenes": [StoryboardScene...], "audioUrl": "...", "audioDurationSec": 8085.8,
  "soundEffect": "fire" }            // "fire" | "meditation" | "none"; default "fire"
```
→ `{ renderId, bucketName, title, durationInFrames, sceneCount }`

`GET {webURL}/render/{renderId}`
→ `{ done, overallProgress, outputFile, fatalErrorEncountered, errors, costsAccrued }`

## Point the app at it
In `lib/remotion/start-render.ts` / `app/api/render/*`, swap the Lambda calls for `fetch`
against `{webURL}/render/start` and `/render/{id}`. The request/response shapes already match
render-panel.tsx, so the UI needs no change. (`costsAccrued` is a Modal-rate estimate; the
real number is on the Modal dashboard.)

## Test
```
modal run render-modal/modal_app.py::test --seconds 180 --sound fire
```
Renders a slice, prints measured cost/time + an extrapolation to the full video.
