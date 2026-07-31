# Switching scene images to cartoon (gamecel)

How to flip scene image generation from the current **photoreal cinematic** look
to a **cel-shaded cartoon** look. Not applied — this is the checklist to apply it.

## What the image API accepts

`POST https://avoajaugochukwu--open-source-image-gen-web.modal.run/generate`

- `prompt` (required, 1–2000 chars)
- `aspect_ratio` (required): `16:9` | `1:1` | `9:16`
- `style` (optional): `cartoon` (default) | `photo`
- `lora` (optional): cartoon LoRA selector — `gamecel`, `cel2d`, `anime`,
  `storybook`, `ink`, `watercolor`, … **Ignored when `style: "photo"`.**
  See the visual reference gallery: [`cartoon-styles/gallery.html`](./cartoon-styles/gallery.html)
  (open in a browser — 20 LoRAs × 2 samples each).
- others: `quality`, `enhance`, `negative_prompt`, `scale`, `steps`, `guidance`,
  `seed`, `n`

**Key gotcha:** the LoRA only applies when `style` is `cartoon`. Sending
`style: "photo"` + `lora: "gamecel"` silently drops the LoRA.

## Changes to make

### 1. `lib/jobs/scene-image.ts` — request params

- Set `style: "cartoon"` (currently `"photo"`).
- Add `lora: "gamecel"`.
- Keep `aspect_ratio: "16:9"`.
- Prepend the cartoon style prefix to the prompt:

  ```
  Clean flat 2D cartoon illustration, cel-shaded stylized video-game art, crisp
  shading, bright saturated color, NOT a photo, NOT photorealistic, drawn not
  photographed. + [the scene's visual_prompt]
  ```

### 2. Remove "photoreal" from the prompt-generation layer

The LLM currently writes prompts *as photoreal film stills*. If we leave that in,
each `visual_prompt` fights the cartoon prefix (period-accurate lighting/lens
language pulls back toward photo). Strip the photoreal direction so the LLM
describes subject/composition only:

- `lib/scene-engine/sleep-scene-prompt.ts:19` — persona says "a photorealistic
  film still, fully directed (… lighting, colour, lens)". Rewrite to cartoon /
  illustration framing; drop lens/photoreal wording.
- `lib/scene-engine/sleep-scene-prompt.ts:23,72` — "photoreal image prompt" in the
  instructions + example schema.
- `lib/scene-engine/script-to-scenes.ts:6,30,146,228` — "cinematic photoreal image
  prompt" in comments + the user prompt at line 146.
- `lib/types/index.ts:16` — `visual_prompt` doc comment ("Cinematic photoreal
  image prompt").

### 3. Housekeeping

- `npx tsc --noEmit`.
- Prepend a `CHANGELOG.md` entry (what changed + why).

## Revert to photoreal

Reverse all of the above: `style: "photo"`, drop `lora`, remove the cartoon
prefix, restore the photoreal prompt-layer wording.
