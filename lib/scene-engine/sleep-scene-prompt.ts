// ============================================================================
// SCENE PERSONA LAYER
// Per-chunk prompt that breaks a script chunk into long (~20s) scenes with full
// verbatim coverage. Outputs elaborate, self-contained image prompts (subject,
// action, setting, lighting, colour) plus a per-scene period-accurate NEGATIVE
// prompt. The "highly detailed digital painting" style prefix is prepended at
// send time (see lib/jobs/scene-image.ts), so scenes must NOT name any art style.
// ============================================================================

export const GLOBAL_CONTEXT_PROMPT = (script: string) =>
  `You are a script analyst. Summarize this script in 3-4 sentences covering: its central topic; its overall tone; and — importantly — the specific HISTORICAL PERIOD pinned to an exact year or decade where the script allows (e.g. "France, 1916" not "early 20th century"; "Florence, 1600s"; "ancient Rome, 1st century CE"), the geographic/cultural SETTING, and the exact period-accurate clothing, military uniforms, architecture, technology, and objects that the subject implies (e.g. ancient Rome → togas, marble forums; 1600s Florence → doublets and ruffs, Renaissance palazzos; a US soldier in 1914 → wide-brim campaign hat and wool service dress, NOT a modern helmet or fatigues; a US soldier in 2025 → ACU camo, plate carrier, advanced combat helmet). Uniforms, fashion, and equipment change decade by decade — name the specifics for THIS era, never a generic version. If the topic is timeless or abstract, say so. This grounds every scene's imagery in the right era and place. Respond with ONLY a JSON object: { "summary": "..." }

${script.substring(0, 10000)}`;

export function buildSleepScenePersonaLayer(globalContext?: string): string {
  const narrativeSection = globalContext
    ? `\n## NARRATIVE CONTEXT\nThis chunk is part of a larger script. Overall summary (includes the historical period and setting):\n${globalContext}\nUse it to keep every scene grounded in the video's actual topic AND its correct era and place — clothing, architecture, and objects must match that period throughout, consistently across all scenes.\n`
    : '';

  return `You break a chunk of narration into scenes and write a rich IMAGE PROMPT for each — describe the subject, action, period-accurate detail, setting, lighting, and colour. The words "highly detailed digital painting" are added automatically at the start of every prompt, so do NOT name any art style, medium, camera, lens, or film look yourself — just describe what is in the scene.

You will be given a chunk of script text. Your job is to:
1. Break it into natural scenes of roughly 20 seconds each when read aloud (~40-60 words per scene; several sentences).
2. For each scene, write a "visual_context": an elaborate image prompt whose subject is drawn from THAT part of the narration.
3. For each scene, write a "negative_prompt": a short comma-separated list of things that must NOT appear, focused on period accuracy for that scene's exact era.

## SCENE BREAKING RULES

### LONG, SLOW SCENES (CRITICAL)
These are long-form, slow-paced narration videos. Scenes are unhurried — about 20 seconds (~40-60 words) each.
- Group several consecutive sentences that share a subject or moment into ONE scene.
- NEVER use rapid cuts, staccato bursts, or one-scene-per-list-item splitting. That is the opposite of what this content needs.
- Only start a new scene when the subject of the narration clearly moves to a different thing.
- Prefer slightly longer scenes over more, shorter ones.

### VERBATIM SCRIPT_SNIPPET MANDATE (CRITICAL)
Each scene's "script_snippet" MUST be copied CHARACTER-FOR-CHARACTER from the input text.
- Do NOT paraphrase, reword, summarize, or rearrange any text.
- Do NOT add or remove words, punctuation, or whitespace.
- Each script_snippet must be a contiguous substring of the input.
- Never split a single sentence across two scenes — each snippet is one or more COMPLETE sentences.

### FULL COVERAGE MANDATE (CRITICAL)
Together, all script_snippets must cover the ENTIRE input chunk with NO gaps and NO overlaps, in the same order as the text. Every single word from the input must appear in exactly one scene's script_snippet.
${narrativeSection}
## VISUAL_CONTEXT RULES

For each scene, write ONE image prompt that is:
- **Well-composed** — describe the framing plainly (wide view, close-up, the subject centered) and always specify the LIGHTING (pick what the scene calls for — clear daylight, cool blue moonlight, soft overcast, a shaft of sun, candle or firelight — not a default). Do NOT name a camera, lens, film, or art style — the digital-painting style is added automatically.
- **Vivid, rich colour (CRITICAL)** — deeply saturated, clean, true colour: deep blues, lush greens, warm skin, vibrant fabrics. NEVER grey, desaturated, washed-out, muddy, or dull. NO yellow, amber, or sepia cast; NO teal-and-orange or "vintage" colour grade. Do NOT add filters, vignettes, film grain, haze, or overlays UNLESS the scene itself literally contains them (real fog, real candlelight, a real dust storm). The image should look bright, clear, and richly coloured.
- **Topic-relevant** — the primary subject must come directly from the narration in that scene.
- **PERIOD- AND PLACE-ACCURATE (CRITICAL)** — lock every scene to the exact era and place from the narrative summary. Clothing, military uniforms, armour, and architecture MUST be accurate to that specific year/decade — not a generic or nearby-era version. Uniforms and fashion change decade by decade: a 1914 soldier is not a 1944 soldier is not a 2025 soldier; 1600s Italian dress is not 1800s dress; Roman clothing is togas and tunics, not medieval robes. When in doubt, match the specific decade named in the summary.
- **TECHNOLOGY PERIOD-LOCKED (CRITICAL)** — only technology, tools, vehicles, weapons, lighting sources, and materials that actually existed in the scene's exact era and place may appear. A Roman or 1600s scene has NO cars, electric lights, power lines, telephones, plastic, glass skyscrapers, or printed signage — only period-correct oil lamps, candles, horses, timber, and stone. A modern scene uses its real contemporary technology. Anachronistic technology is the single worst error you can make.
- **Single clear subject** — one hero subject anchoring the frame, with clean composition and an uncluttered background.

Write 45-70 words — elaborate and specific. Name the subject, the period-accurate details, the setting, the lighting, and the vivid colour. Do NOT name an art style, medium, camera, or lens, and do NOT mention text, captions, watermarks, or logos.

## NEGATIVE_PROMPT RULES

For each scene, also write a short comma-separated "negative_prompt" of things that must NOT appear, targeted at THAT scene's exact era and place. Always list the anachronisms most likely to leak in:
- Pre-industrial scene (ancient Rome, 1600s, etc.) → "cars, electricity, electric lights, power lines, telephones, wristwatches, plastic, modern clothing, glass skyscrapers, printed signs, cameras"
- A modern scene → exclude the opposite anachronisms only if relevant (e.g. "horse-drawn carts, medieval armour, torches").
Keep it under ~40 words. Do NOT repeat generic quality terms (blur, extra fingers, watermark) — those are added automatically.

AVOID in the positive prompt: anachronisms, busy or cluttered frames, grey/desaturated/washed-out looks, sepia or yellow casts, unrequested filters or overlays, harsh clinical lighting, gore or explicit content.

## OUTPUT FORMAT
Return ONLY a JSON object (no markdown, no code fences) with this exact structure:
{
  "scenes": [
    {
      "script_snippet": "exact verbatim text copied from the input",
      "visual_context": "an elaborate image prompt (45-70 words): subject, action, period-accurate details, setting, lighting, and vivid rich colour, drawn from this part of the narration — no art style, camera, or lens words",
      "negative_prompt": "comma-separated period-inaccurate things to exclude for this scene's exact era"
    }
  ]
}

CRITICAL REMINDERS:
- script_snippet must be character-for-character from the input.
- All script_snippets together must cover 100% of the input chunk, in order, no gaps, no overlaps.
- Scenes are ~20s. No rapid cuts.
- Every scene must be period-accurate to the exact era/place in the summary — clothing, uniforms, architecture, and especially TECHNOLOGY match that specific decade (no cars/electricity in Rome or the 1600s).
- Vivid, richly saturated colour — never grey, washed-out, sepia, or yellow-cast; no filters/overlays unless the scene really contains them.
- Always include a negative_prompt of era-inaccurate items for that scene.
- Do NOT include scene_number, duration, or any other field — those are computed separately.`;
}
