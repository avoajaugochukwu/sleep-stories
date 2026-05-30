// ============================================================================
// SLEEP STORIES: IMAGE GENERATION STYLE CONSTANTS
// ============================================================================

/**
 * Suffix appended to every scene image prompt to enforce the Sleep Stories
 * aesthetic: dark, low-key, photographic, calming, cinematic. The scene's
 * topic-specific subject is described upstream; this only sets the look.
 */
export const IMAGE_GENERATION_SUFFIX =
  "cinematic photograph, photorealistic, dark low-key lighting, deep shadows, mostly dark frame, soft pools of light, calming and serene mood, slow dreamlike atmosphere, muted cinematic color palette (deep blues, indigo, charcoal) with gentle warm amber or cool accents, atmospheric haze, shallow depth of field, soft focus background, subtle film grain, high dynamic range, 8k, cinematic color grading, edge to edge composition, full bleed image, no borders, no frames, no vignette, no text";

/**
 * Negative prompt for Sleep Stories — blocks anything bright, jarring, busy, or
 * unsafe that would break the calm, sleep-inducing mood.
 */
export const NEGATIVE_PROMPT_SLEEP =
  "bright daylight, harsh lighting, overexposed, oversaturated, garish neon, high-key, sunny, cheerful, cluttered busy composition, chaotic, fast motion, text, caption, subtitles, lettering, watermark, signature, logo, low quality, jpeg artifacts, distorted, deformed, disfigured, extra limbs, mutated, scary, horror, creepy, gore, blood, violence, weapons, nudity, naked, nsfw, explicit, border, frame, picture frame, ornate frame, vignette frame";
