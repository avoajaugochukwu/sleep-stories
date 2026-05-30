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
}
