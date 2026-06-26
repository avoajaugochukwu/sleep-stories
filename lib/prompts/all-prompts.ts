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
  "Cinematic photorealistic film still with a dark, low-key, moody look — deep shadows, a calm, serene, dreamlike mood, anamorphic widescreen framing, and a soft filmic color grade. Motivated directional light and faint atmospheric haze give the frame depth. If any neon color is named above, render it as a single small soft glowing accent motivated by a light source in the scene; otherwise keep the frame in muted, dark cinematic tones throughout. Shallow depth of field, gentle film grain, rich fine detail, full-frame edge-to-edge composition.";
