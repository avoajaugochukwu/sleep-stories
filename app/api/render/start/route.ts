import { NextResponse } from "next/server";
import type { StoryboardScene } from "@/lib/types";
import { startRenderForScenes } from "@/lib/remotion/start-render";

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
    const result = await startRenderForScenes({
      scenes,
      audioUrl,
      audioDurationSec,
      soundEffect,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
