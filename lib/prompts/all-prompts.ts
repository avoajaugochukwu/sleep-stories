// ============================================================================
// SLEEP STORIES: IMAGE GENERATION STYLE CONSTANTS
// ============================================================================

/**
 * Suffix appended to every scene image prompt to enforce the Sleep Stories
 * aesthetic. Written as ONE short natural-language sentence on purpose: Z-Image
 * is a natural-language prompt follower, and the old comma-tag/negation soup
 * ("mostly dark frame, atmospheric haze, soft focus, no confetti…") muddied its
 * output and rendered the "no X" words as objects. Keep this concise — the
 * scene's subject and single neon color are described upstream.
 */
export const IMAGE_GENERATION_SUFFIX =
  "Cinematic, photorealistic photograph with a dark, low-key, moody look — deep shadows and a calm, serene, dreamlike mood. The only vivid color is one small soft glowing neon accent in the single color named above, motivated by a light source in the scene; everything else stays in muted, dark cinematic tones. Shallow depth of field, gentle film grain, rich fine detail, full-frame edge-to-edge composition.";

/**
 * Negative prompt for Sleep Stories — blocks anything bright, jarring, busy, or
 * unsafe that would break the calm, sleep-inducing mood.
 */
export const NEGATIVE_PROMPT_SLEEP =
  "bright daylight, harsh lighting, overexposed, blown-out highlights, high-key, sunny, cheerful, cluttered busy composition, chaotic, confetti, scattered colored particles, floating neon dots, neon confetti, fast motion, text, caption, subtitles, lettering, watermark, signature, logo, low quality, jpeg artifacts, distorted, deformed, disfigured, extra limbs, mutated, scary, horror, creepy, gore, blood, violence, weapons, nudity, naked, nsfw, explicit, border, frame, picture frame, ornate frame, vignette frame";
