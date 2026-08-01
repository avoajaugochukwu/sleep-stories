import type { StoryboardScene } from "@/lib/types";
import { SOUND_EFFECTS, type SoundEffectKey } from "./sound-effects";
import { deriveStoryTitle } from "@/lib/scene-engine/story-text";
import { scaleScenesToAudio } from "@/lib/scene-engine/cut-script";
import { startModalRender } from "@/lib/render/modal";

export interface StartRenderResult {
  renderId: string;
  bucketName: string;
  title: string;
  durationInFrames: number;
  sceneCount: number;
}

/**
 * Derive the title (one Claude call, or the caller's own) and kick the cheap
 * Modal ffmpeg render. Shared by the interactive route (app/api/render/start)
 * and the background worker (lib/jobs/worker) so both produce identical renders.
 *
 * Modal composites the whole video itself (timing, crossfades, overlays, stars,
 * grain, captions, title card) from the raw scenes + audio — so all this side
 * does is pick a title and hand off.
 */
export async function startRenderForScenes(opts: {
  scenes: StoryboardScene[];
  audioUrl: string;
  audioDurationSec: number;
  soundEffect?: string;
  /** Overlay pack prefix (`fire` | `space`). See lib/render/modal.ts. */
  overlayPack?: string;
  /** Override the AI title (e.g. ClickUp task name) — also names the render file. */
  title?: string;
}): Promise<StartRenderResult> {
  const { scenes, audioUrl, audioDurationSec, soundEffect, overlayPack } = opts;

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

  const timedScenes = scaleScenesToAudio(scenes, audioDurationSec);

  // Prefer a caller-supplied title (ClickUp task name); only ask the model otherwise.
  const title = opts.title?.trim() || (await deriveStoryTitle(scenes));

  const start = await startModalRender({
    scenes: timedScenes,
    audioUrl,
    audioDurationSec,
    soundEffect: soundEffectKey,
    overlayPack,
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
