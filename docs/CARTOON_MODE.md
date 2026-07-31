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

### 2. Restyle the prompt-generation layer

The prompt layer writes scenes as *photoreal film stills*. Left in, each
`visual_prompt` fights the cartoon prefix — period-accurate lighting and lens
language pulls back toward photo. Strip the photoreal direction so the model
describes subject and composition only.

All of it lives in the director agent now (this used to be spread across
`sleep-scene-prompt.ts` and `no-gap-breakdown.ts`, both deleted):

- `agents/scene_director/prompt.py` — the persona and the per-genre briefs.
  Rewrite the framing to illustration; drop lens/photoreal wording.
- `agents/scene_director/checks.py` — the denylist. It currently **bans**
  "digital painting" and friends, because `STYLE_PREFIX` already prepends them
  and a second style phrase in the prompt doubled up. Going cartoon means that
  ban has to move to the new prefix's wording, not just be deleted.
- `agents/scene_director/test_scene_director.py` — the denylist assertions pin
  the current wording. Update in the same change (see `agents/CLAUDE.md`).
- `lib/types/index.ts` — `visual_prompt` doc comment.

Note `STYLE_PREFIX` in `lib/jobs/scene-image.ts:10` is prepended at generation
time, and `stripLeadingStyle()` removes a leading copy first so retries stay
idempotent. Both need to match whatever the new prefix is.

### 3. Housekeeping

- `npx tsc --noEmit`, `npm run check:agents`.
- Prepend a `docs/CHANGELOG.md` entry (what changed + why).

## Revert to photoreal

Reverse all of the above: `style: "photo"`, drop `lora`, remove the cartoon
prefix, restore the photoreal prompt-layer wording.
