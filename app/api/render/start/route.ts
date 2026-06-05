import { NextResponse } from "next/server";
import type { StoryboardScene } from "@/lib/types";
import {
  buildSleepVideoInput,
  SOUND_EFFECTS,
  type SoundEffectKey,
} from "@/lib/remotion/build-input";
import { planStoryText } from "@/lib/scene-engine/story-text";
import { startSleepRender } from "@/lib/remotion/lambda";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  scenes?: StoryboardScene[];
  audioUrl?: string;
  audioDurationSec?: number;
  /** Which looping ambient bed to mix under the narration ("fire"/"meditation"/"none"). */
  soundEffect?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { scenes, audioUrl, audioDurationSec, soundEffect } = body;

  // Accept a known bed key or "none"; anything else falls back to the default.
  const soundEffectKey: SoundEffectKey | "none" =
    soundEffect === "none" || (!!soundEffect && soundEffect in SOUND_EFFECTS)
      ? (soundEffect as SoundEffectKey | "none")
      : "fire";

  if (!Array.isArray(scenes) || scenes.length === 0) {
    return NextResponse.json({ error: "No scenes provided" }, { status: 400 });
  }
  if (!audioUrl) {
    return NextResponse.json(
      { error: "Missing audioUrl — add the narration audio URL first" },
      { status: 400 },
    );
  }
  if (!audioDurationSec || audioDurationSec <= 0) {
    return NextResponse.json(
      { error: "Missing or invalid audioDurationSec" },
      { status: 400 },
    );
  }

  try {
    // The user-provided URL points straight at their S3 object — hand it to the
    // Lambda as-is. No upload, no presign: just the link.
    const input = buildSleepVideoInput({
      scenes,
      audioUrl,
      audioDurationSec,
      soundEffect: soundEffectKey,
    });

    // Derive the title + bottom-left captions from the script (one Claude call).
    // The title drives both the title card and the S3 output filename.
    const { title, textOverlays } = await planStoryText({
      renderScenes: input.scenes,
      storyboard: scenes,
      fps: input.fps,
      totalFrames: input.durationInFrames,
    });
    input.title = title;
    input.textOverlays = textOverlays;

    const { renderId, bucketName } = await startSleepRender(input);

    return NextResponse.json({
      renderId,
      bucketName,
      title,
      durationInFrames: input.durationInFrames,
      sceneCount: input.scenes.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
