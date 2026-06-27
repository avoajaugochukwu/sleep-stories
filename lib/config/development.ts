// Development mode flag
export const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

// Fallback scene duration for video production (in seconds). The no-gap
// breakdown derives a real per-scene duration from word count (~20s target);
// this is only used where a per-scene value isn't available.
export const SCENE_DURATION_SECONDS = 20;
