import type { StoryboardScene } from "@/lib/types";
import {
  buildSleepVideoInput,
  SOUND_EFFECTS,
  type SoundEffectKey,
} from "./build-input";
import { planStoryText } from "@/lib/scene-engine/story-text";
import { startModalRender } from "@/lib/render/modal";

export interface StartRenderResult {
  renderId: string;
  bucketName: string;
  title: string;
  durationInFrames: number;
  sceneCount: number;
}

/**
 * Derive the title (one Claude call via planStoryText) and kick the cheap Modal
 * ffmpeg render. Shared by the interactive route (app/api/render/start) and the
 * background worker (lib/jobs/worker) so both produce identical renders.
 *
 * ponytail: Modal composites the whole video itself (overlays, stars, grain,
 * captions, title) from the raw scenes — we only still build the Remotion input
 * + run planStoryText to get the AI title. The textOverlays it returns are
 * unused (Modal makes its own captions); drop build-input/planStoryText here if
 * a plain title (job name / first line) is ever good enough.
 */
export async function startRenderForScenes(opts: {
  scenes: StoryboardScene[];
  audioUrl: string;
  audioDurationSec: number;
  soundEffect?: string;
}): Promise<StartRenderResult> {
  const { scenes, audioUrl, audioDurationSec, soundEffect } = opts;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("No scenes provided");
  }
  if (!audioUrl) throw new Error("Missing audioUrl");
  if (!audioDurationSec || audioDurationSec <= 0) {
    throw new Error("Missing or invalid audioDurationSec");
  }

  // Accept a known bed key or "none"; anything else falls back to the default.
  const soundEffectKey: SoundEffectKey | "none" =
    soundEffect === "none" || (!!soundEffect && soundEffect in SOUND_EFFECTS)
      ? (soundEffect as SoundEffectKey | "none")
      : "fire";

  const input = buildSleepVideoInput({
    scenes,
    audioUrl,
    audioDurationSec,
    soundEffect: soundEffectKey,
  });

  const { title } = await planStoryText({
    renderScenes: input.scenes,
    storyboard: scenes,
    fps: input.fps,
    totalFrames: input.durationInFrames,
  });

  const start = await startModalRender({
    scenes,
    audioUrl,
    audioDurationSec,
    soundEffect: soundEffectKey,
    title,
  });

  return {
    renderId: start.renderId,
    bucketName: start.bucketName,
    title: start.title || title,
    durationInFrames: start.durationInFrames,
    sceneCount: start.sceneCount,
  };
}
