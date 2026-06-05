import { NextResponse } from "next/server";
import { presignAudioUpload } from "@/lib/aws/s3";

export const runtime = "nodejs";

type Body = {
  filename?: string;
  contentType?: string;
};

// Hand back a presigned PUT URL so the browser uploads the narration mp3 straight
// to our bucket's audio/ prefix. No file ever streams through this server — we
// only sign the target — so the Next.js/Railway body-size limit doesn't apply.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim();

  if (!filename) {
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });
  }
  if (!contentType || !contentType.startsWith("audio/")) {
    return NextResponse.json(
      { error: "contentType must be an audio/* MIME type" },
      { status: 400 },
    );
  }

  try {
    const target = await presignAudioUpload(filename, contentType);
    return NextResponse.json(target);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
