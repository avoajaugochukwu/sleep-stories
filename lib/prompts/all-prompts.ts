// ============================================================================
// SLEEP STORIES: IMAGE GENERATION STYLE CONSTANTS
// ============================================================================

/**
 * Art-style suffix appended app-side to every SUBJECT-ONLY scene prompt. Muted
 * inked-watercolor storybook style, rendered VERBATIM by the Krea-2 `cartoon`
 * endpoint (the cartoon LoRA supplies the ink+wash texture; the suffix sets the
 * soft muted palette). The scene-writer LLM must NOT add any style/medium/colour
 * words — they come from here.
 */
export const IMAGE_GENERATION_SUFFIX =
  "inked watercolor storybook illustration, soft ink linework, painterly watercolor washes, muted palette, soft diffused light, gentle grain";
