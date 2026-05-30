import { NextResponse } from "next/server";
import { presignAudioUpload, sanitizeName } from "@/lib/aws/s3";

export const runtime = "nodejs";

// Returns a presigned PUT URL so the browser uploads narration audio straight
// to S3. We hand back the object `key` (not a public URL) — the render route
// turns it into a short-lived presigned GET for the Lambda renderer.
export async function POST(req: Request) {
  let body: { name?: string; type?: string };
  try {
    body = (await req.json()) as { name?: string; type?: string };
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const name = sanitizeName(body.name ?? "audio");
  const contentType = body.type || "audio/mpeg";

  // Per-upload prefix avoids collisions without needing a random lib.
  const stamp = `${Date.now().toString(36)}-${Math.round(
    performance.now(),
  ).toString(36)}`;
  const key = `audio/${stamp}-${name}`;

  try {
    const uploadUrl = await presignAudioUpload({ key, contentType });
    return NextResponse.json({ uploadUrl, key, contentType });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
