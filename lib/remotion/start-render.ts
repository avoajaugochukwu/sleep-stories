import type { StoryboardScene } from "@/lib/types";
import {
  buildSleepVideoInput,
  SOUND_EFFECTS,
  type SoundEffectKey,
} from "./build-input";
import { planStoryText } from "@/lib/scene-engine/story-text";
import { startSleepRender } from "./lambda";

export interface StartRenderResult {
  renderId: string;
  bucketName: string;
  title: string;
  durationInFrames: number;
  sceneCount: number;
}

/**
 * Build the Remotion input, derive title + captions (one Claude call), and kick
 * the Lambda render. Shared by the interactive route (app/api/render/start) and
 * the background worker (lib/jobs/worker) so both produce identical renders.
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

  const { title, textOverlays } = await planStoryText({
    renderScenes: input.scenes,
    storyboard: scenes,
    fps: input.fps,
    totalFrames: input.durationInFrames,
  });
  input.title = title;
  input.textOverlays = textOverlays;

  const { renderId, bucketName } = await startSleepRender(input);

  return {
    renderId,
    bucketName,
    title,
    durationInFrames: input.durationInFrames,
    sceneCount: input.scenes.length,
  };
}
