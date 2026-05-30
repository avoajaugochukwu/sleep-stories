import type { StoryboardScene } from "@/lib/types";
import type { SleepRenderScene, SleepVideoInputProps } from "./types";

// Render geometry. 30fps is plenty for slow sleep visuals and keeps the frame
// count (and Lambda cost) reasonable for long narrations.
export const RENDER_FPS = 30;
export const RENDER_WIDTH = 1920;
export const RENDER_HEIGHT = 1080;

// Soft blend between scenes (no hard cut, no slide).
const CROSSFADE_SEC = 1.2;

// Show a gentle on-screen line only every Nth scene so text stays rare.
const GENTLE_LINE_EVERY = 6;

/**
 * Turn a verbatim script snippet into a short, calm on-screen line: first
 * clause/sentence, trimmed, no trailing punctuation, capped length.
 */
export function toGentleLine(snippet: string, maxChars = 64): string {
  const cleaned = snippet.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  // Prefer the first sentence/clause boundary.
  const firstChunk = cleaned.split(/(?<=[.!?,;:—])\s/)[0] ?? cleaned;
  let line = firstChunk.trim();
  if (line.length > maxChars) {
    line = line.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  }
  // Drop trailing punctuation for a softer look.
  line = line.replace(/[.,;:!?—-]+$/, "").trim();
  return line;
}

/**
 * Build the Remotion input props from the storyboard + uploaded audio.
 *
 * Timing strategy ("stretch to fill"): every scene keeps its relative weight
 * (word-count estimate), and all weights are scaled so the scenes exactly
 * cover the real audio duration — no gaps, no trailing silence, full script
 * coverage. Rounding remainder is distributed by largest fractional part so
 * the frame totals add up to the audio length precisely.
 */
export function buildSleepVideoInput(opts: {
  scenes: StoryboardScene[];
  audioUrl: string;
  audioDurationSec: number;
  title?: string;
}): SleepVideoInputProps {
  const { scenes, audioUrl, audioDurationSec, title } = opts;

  const fps = RENDER_FPS;
  const totalFrames = Math.max(1, Math.round(audioDurationSec * fps));

  const ordered = [...scenes].sort((a, b) => a.scene_number - b.scene_number);
  if (ordered.length === 0) {
    return {
      audioUrl,
      fps,
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      durationInFrames: totalFrames,
      title,
      scenes: [],
      crossfadeFrames: Math.round(CROSSFADE_SEC * fps),
    };
  }

  // Relative weights from estimated durations (fallback to 1 so every scene
  // still gets a slice).
  const weights = ordered.map((s) => Math.max(0.001, s.duration ?? 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const rawFrames = weights.map((w) => (w / totalWeight) * totalFrames);
  const floored = rawFrames.map((f) => Math.max(1, Math.floor(f)));
  const used = floored.reduce((a, b) => a + b, 0);

  // Reconcile to exactly totalFrames. If we floored below target, hand the
  // remainder to the scenes with the largest fractional parts; if we went over
  // (because of the min-1 clamp on tiny scenes), trim the longest scenes.
  let diff = totalFrames - used;
  if (diff > 0) {
    const byFrac = rawFrames
      .map((f, i) => ({ i, frac: f - Math.floor(f) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < diff; k++) floored[byFrac[k % byFrac.length].i] += 1;
  } else if (diff < 0) {
    const byLen = floored
      .map((f, i) => ({ i, f }))
      .sort((a, b) => b.f - a.f);
    let k = 0;
    while (diff < 0) {
      const idx = byLen[k % byLen.length].i;
      if (floored[idx] > 1) {
        floored[idx] -= 1;
        diff += 1;
      }
      k += 1;
      // Safety valve in the pathological case where everything is already 1.
      if (k > floored.length * totalFrames) break;
    }
  }

  // Carry forward the last seen image so scenes that failed generation still
  // show something (we never drop a scene — full script coverage).
  let lastImage = ordered.find((s) => s.image_url)?.image_url ?? "";

  const renderScenes: SleepRenderScene[] = [];
  let cursor = 0;
  ordered.forEach((s, i) => {
    const dur = Math.max(1, floored[i]);
    if (s.image_url) lastImage = s.image_url;
    const showLine =
      i > 0 && i % GENTLE_LINE_EVERY === 0 && !!s.script_snippet?.trim();
    renderScenes.push({
      id: `scene-${s.scene_number}`,
      imageUrl: s.image_url || lastImage,
      startFrame: cursor,
      durationInFrames: dur,
      zoom: i % 2 === 0 ? "in" : "out",
      caption: showLine ? toGentleLine(s.script_snippet) || undefined : undefined,
    });
    cursor += dur;
  });

  return {
    audioUrl,
    fps,
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    durationInFrames: totalFrames,
    title,
    scenes: renderScenes,
    crossfadeFrames: Math.round(CROSSFADE_SEC * fps),
  };
}
