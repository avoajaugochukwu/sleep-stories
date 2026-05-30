// ============================================================================
// REMOTION RENDER CONTRACT (self-contained — not shared with any other app)
// ----------------------------------------------------------------------------
// These are the input props the Lambda composition receives. They are fully
// pre-computed on the server (build-input.ts) so the composition never has to
// fetch the audio or guess timings: every scene already has an exact
// startFrame/durationInFrames, and the total duration matches the audio.
// ============================================================================

export interface SleepRenderScene {
  /** Stable key, derived from the source scene number. */
  id: string;
  /** Public image URL (FAL CDN). Reused from a neighbour if a scene had none. */
  imageUrl: string;
  /** Absolute start position on the timeline, in frames. */
  startFrame: number;
  /** Length of this scene, in frames (audio-stretched). */
  durationInFrames: number;
  /** Ken Burns direction; alternates scene-to-scene for gentle variety. */
  zoom: "in" | "out";
  /**
   * Optional short, calming line drawn from the script snippet. Only a few
   * scenes carry one (see GENTLE_LINE_EVERY) to keep the sleep mood.
   */
  caption?: string;
}

/**
 * One scheduled *appearance* of an overlay clip on the timeline. Rather than a
 * couple of clips running the whole video, all six clips take turns: each
 * appearance plays for `durationInFrames` starting at `startFrame`, fading in
 * and out, then the next one (a different clip) shows later. The clip itself is
 * looped within its window if the window outlasts the (slowed) clip.
 */
export interface SleepOverlay {
  /**
   * Path under public/ for staticFile(), e.g. "overlays/blue_smoke.mp4".
   * These are dark "additive" clips (smoke/fire/light on black) composited
   * with mixBlendMode:"screen", so the black contributes nothing — no alpha
   * keying needed.
   */
  src: string;
  /** Native clip length in seconds — used to size the loop window. */
  durationInSeconds: number;
  /** When this appearance starts on the timeline, in frames. */
  startFrame: number;
  /** How long this appearance stays on screen, in frames. */
  durationInFrames: number;
  /** Fade in/out length, in frames, so appearances never pop on/off. */
  fadeFrames: number;
  /** Playback speed; <1 slows the motion (these clips run too fast at 1x). */
  playbackRate: number;
  /** Screen-blend opacity — kept low so it reads as atmosphere, not subject. */
  opacity: number;
  /** Mirror horizontally, for extra per-video variety. */
  flip?: boolean;
}

export interface SleepVideoInputProps {
  // Remotion's <Composition> constrains input props to Record<string, unknown>.
  // The declared members below keep their precise types; this just satisfies
  // the index-signature requirement.
  [key: string]: unknown;
  /** Narration audio (a presigned S3 GET URL at render time). */
  audioUrl: string;
  fps: number;
  width: number;
  height: number;
  /** Total timeline length = round(audioDurationSec * fps). */
  durationInFrames: number;
  /** Optional title shown on a soft fade-in card at the very start. */
  title?: string;
  scenes: SleepRenderScene[];
  /** Crossfade overlap between consecutive scenes, in frames. */
  crossfadeFrames: number;
  /**
   * Screen-blended ambient video overlays, chosen randomly per render so no two
   * videos carry the same moving texture (variety to avoid duplicate-detection
   * pattern-matching). Looped to fill the whole timeline.
   */
  overlays?: SleepOverlay[];
}
