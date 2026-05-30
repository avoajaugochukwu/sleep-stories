import { NextResponse } from "next/server";
import type { StoryboardScene } from "@/lib/types";
import { buildSleepVideoInput } from "@/lib/remotion/build-input";
import { startSleepRender } from "@/lib/remotion/lambda";
import { presignAudioDownload } from "@/lib/aws/s3";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  scenes?: StoryboardScene[];
  audioKey?: string;
  audioDurationSec?: number;
  title?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { scenes, audioKey, audioDurationSec, title } = body;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    return NextResponse.json({ error: "No scenes provided" }, { status: 400 });
  }
  if (!audioKey) {
    return NextResponse.json(
      { error: "Missing audioKey — upload the narration audio first" },
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
    // Presigned GET so the Lambda can fetch the (private) audio over HTTPS.
    const audioUrl = await presignAudioDownload(audioKey);

    const input = buildSleepVideoInput({
      scenes,
      audioUrl,
      audioDurationSec,
      title: title?.trim() || undefined,
    });

    const { renderId, bucketName } = await startSleepRender(input);

    return NextResponse.json({
      renderId,
      bucketName,
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
