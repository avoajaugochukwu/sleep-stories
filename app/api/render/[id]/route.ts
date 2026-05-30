import { NextResponse } from "next/server";
import { fetchSleepRenderProgress } from "@/lib/remotion/lambda";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bucketName = new URL(req.url).searchParams.get("bucket");
  if (!bucketName) {
    return NextResponse.json(
      { error: "bucket query param required" },
      { status: 400 },
    );
  }

  try {
    const p = await fetchSleepRenderProgress(id, bucketName);
    return NextResponse.json({
      done: p.done,
      overallProgress: p.overallProgress ?? 0,
      outputFile: p.outputFile ?? null,
      fatalErrorEncountered: p.fatalErrorEncountered ?? false,
      errors: p.errors ?? [],
      costsAccrued: p.costs?.accruedSoFar ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
