/**
 * Application Constants
 */

/**
 * Maximum number of unique images to generate per video.
 * Videos with this many scenes or fewer get one unique image per scene.
 * Longer videos reuse images from this pool, distributed across the extra
 * scenes, capping image-generation cost at this many calls per video.
 */
export const MAX_GENERATED_IMAGES = 100;

/**
 * Target narration length per scene, in seconds. Sleep content uses long,
 * slow scenes. Used for UI estimates; the no-gap breakdown derives the real
 * per-scene duration from word count.
 */
export const SECONDS_PER_SCENE = 30;
