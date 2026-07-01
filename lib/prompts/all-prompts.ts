// ============================================================================
// SLEEP STORIES: IMAGE GENERATION STYLE CONSTANTS
// ============================================================================

/**
 * Art-style suffix appended app-side to every SUBJECT-ONLY scene prompt. This is
 * the concluded "recipe D" vivid inked-storybook style, rendered VERBATIM by the
 * Krea-2 `cartoon` endpoint (the cartoon LoRA supplies the ink+wash texture; the
 * suffix unlocks bold saturated colour). The scene-writer LLM must NOT add any
 * style/medium/colour words — they come from here.
 *
 * Source of truth: open/krea2-style-presets.md — keep in sync.
 */
export const IMAGE_GENERATION_SUFFIX =
  "Detailed hand-drawn ink illustration, fine cross-hatched ink linework, layered rich painted colour, warm-and-cool light, intricate storybook detail, painterly, atmospheric, cinematic composition, full-bleed 16:9, bold vivid saturated colours, inked storybook style";
