import type { StoryboardScene } from "@/lib/types";
import type {
  SleepOverlay,
  SleepRenderScene,
  SleepSoundEffect,
  SleepVideoInputProps,
} from "./types";

// Looping ambient beds, mixed UNDER the narration. Each carries its OWN volume:
// a fuller track (the meditation pad) sits lower than a sparse one (fire) so it
// never overpowers the voice. Files live in public/sound-effects/ (bundled into
// the deployed site, so staticFile() resolves them on Lambda). Pick one per
// render in the UI — or "none" for a silent test render.
export const SOUND_EFFECTS = {
  fire: {
    label: "Fire crackling",
    src: "sound-effects/soundreality-fire-ambience-528618.mp3",
    volume: 0.18,
  },
  meditation: {
    label: "Meditation ambient",
    src: "sound-effects/quietphase-meditation-ambient-484356.mp3",
    // A continuous musical pad reads louder than crackle, so keep it well under
    // the narration.
    volume: 0.08,
  },
} as const satisfies Record<string, SleepSoundEffect & { label: string }>;

export type SoundEffectKey = keyof typeof SOUND_EFFECTS;

// Ambient overlay clips living in public/overlays/ (bundled into the deployed
// site, so staticFile() resolves them on Lambda). They're smoke/fog/light/fire
// on a black background, composited with screen blend in OverlayVideos.tsx.
const OVERLAY_POOL: { src: string; durationInSeconds: number }[] = [
  { src: "overlays/blue_smoke_later_in_video.mp4", durationInSeconds: 20 },
  { src: "overlays/bubbles_smoke_later_in_video.mp4", durationInSeconds: 15 },
  { src: "overlays/full_screen_light_cloud.mp4", durationInSeconds: 15 },
  {
    src: "overlays/light_white_smoke_rising_from_bottom.mp4",
    durationInSeconds: 40.95,
  },
  { src: "overlays/love_vortex.mp4", durationInSeconds: 15 },
  { src: "overlays/red_faint_fire.mp4", durationInSeconds: 12 },
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Each appearance shows for this long, then (sometimes) a gap of bare scene
// before the next clip takes over. Tuned for ~2h videos: short enough that all
// six clips cycle many times, long enough to feel calm, not flickery.
const OVERLAY_SEG_MIN_SEC = 45;
const OVERLAY_SEG_MAX_SEC = 150;
const OVERLAY_GAP_MAX_SEC = 40; // longest stretch of no overlay
const OVERLAY_GAP_CHANCE = 0.35; // how often a gap follows an appearance
const OVERLAY_FADE_SEC = 2.5; // fade in/out so nothing pops on/off

/**
 * Build a randomised *schedule* of overlay appearances covering the whole
 * timeline. All six clips take turns (reshuffled rotation, so every clip is
 * used and order varies), each appearing for a random length with a random
 * (slow) speed, opacity and flip, separated by occasional gaps of bare scene.
 *
 * The randomness is per-render — baked into the input props — so every Lambda
 * worker still renders identical frames, but no two published videos share the
 * same sequence of textures (variety to dodge duplicate-detection pattern
 * matching). Scales to any duration; for a 2h video this yields ~70 turns.
 */
export function scheduleOverlays(totalFrames: number, fps: number): SleepOverlay[] {
  const fadeFrames = Math.round(OVERLAY_FADE_SEC * fps);
  const schedule: SleepOverlay[] = [];

  // Reshuffled rotation: pull clips in a random order, reshuffling each time the
  // pool is exhausted, so every clip appears before any repeats.
  let bag: typeof OVERLAY_POOL = [];
  const nextClip = () => {
    if (bag.length === 0) bag = [...OVERLAY_POOL].sort(() => Math.random() - 0.5);
    return bag.pop()!;
  };

  let cursor = 0;
  while (cursor < totalFrames) {
    const clip = nextClip();
    const segFrames = Math.round(rand(OVERLAY_SEG_MIN_SEC, OVERLAY_SEG_MAX_SEC) * fps);
    const durationInFrames = Math.min(segFrames, totalFrames - cursor);
    // Skip a sliver at the very end that's too short to fade cleanly.
    if (durationInFrames < fadeFrames) break;

    schedule.push({
      src: clip.src,
      durationInSeconds: clip.durationInSeconds,
      startFrame: cursor,
      durationInFrames,
      fadeFrames,
      playbackRate: rand(0.25, 0.45),
      opacity: rand(0.16, 0.28),
      flip: Math.random() < 0.5,
    });

    cursor += durationInFrames;
    if (Math.random() < OVERLAY_GAP_CHANCE) {
      cursor += Math.round(rand(0, OVERLAY_GAP_MAX_SEC) * fps);
    }
  }

  return schedule;
}

// Render geometry. 30fps is plenty for slow sleep visuals and keeps the frame
// count (and Lambda cost) reasonable for long narrations. 24fps (cinematic) —
// the visuals are deliberately slow, so the drop from 30 is invisible but cuts
// frame count (and therefore Lambda compute) by ~20%.
export const RENDER_FPS = 24;
export const RENDER_WIDTH = 1920;
export const RENDER_HEIGHT = 1080;

// Soft blend between scenes (no hard cut, no slide).
const CROSSFADE_SEC = 1.2;

/**
 * Turn a verbatim script snippet into a short, calm on-screen line: first
 * clause/sentence, trimmed, no trailing punctuation, capped length. Used as a
 * fallback caption in story-text.ts when the AI pass is unavailable.
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
  /** Which looping ambient bed to mix under the narration; "none" for silence. */
  soundEffect?: SoundEffectKey | "none";
}): SleepVideoInputProps {
  const {
    scenes,
    audioUrl,
    audioDurationSec,
    soundEffect: soundKey = "fire",
  } = opts;

  const fps = RENDER_FPS;
  const totalFrames = Math.max(1, Math.round(audioDurationSec * fps));
  const sel = soundKey === "none" ? undefined : SOUND_EFFECTS[soundKey];
  const soundEffect: SleepSoundEffect | undefined = sel
    ? { src: sel.src, volume: sel.volume }
    : undefined;

  const ordered = [...scenes].sort((a, b) => a.scene_number - b.scene_number);
  if (ordered.length === 0) {
    return {
      audioUrl,
      fps,
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      durationInFrames: totalFrames,
      scenes: [],
      crossfadeFrames: Math.round(CROSSFADE_SEC * fps),
      overlays: scheduleOverlays(totalFrames, fps),
      soundEffect,
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
    renderScenes.push({
      id: `scene-${s.scene_number}`,
      imageUrl: s.image_url || lastImage,
      startFrame: cursor,
      durationInFrames: dur,
      zoom: i % 2 === 0 ? "in" : "out",
    });
    cursor += dur;
  });

  return {
    audioUrl,
    fps,
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    durationInFrames: totalFrames,
    scenes: renderScenes,
    crossfadeFrames: Math.round(CROSSFADE_SEC * fps),
    overlays: scheduleOverlays(totalFrames, fps),
    soundEffect,
  };
}
