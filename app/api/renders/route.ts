import { NextResponse } from "next/server";
import { deleteRenderObject, listRecentRenders } from "@/lib/aws/s3";
import { getUploadedMap, setUploaded } from "@/lib/jobs/render-meta";
import { listVisibleJobs } from "@/lib/jobs/store";
import { clickupTaskUrl } from "@/lib/jobs/clickup";

export const runtime = "nodejs";

// List finished renders from the last 7 days, each carrying its persistent
// "uploaded" flag and — when the render came from a job we still have — the
// ClickUp task link, so you can jump to the job from the render row.
export async function GET() {
  try {
    const [renders, uploaded, jobs] = await Promise.all([
      listRecentRenders(),
      getUploadedMap(),
      listVisibleJobs().catch(() => []),
    ]);
    // renderId -> ClickUp URL, via the render id stored in each job's export.
    const clickupByRender = new Map<string, string>();
    for (const j of jobs) {
      const rid = j.projectJson?.state?.renders?.[0]?.renderId;
      if (rid) clickupByRender.set(rid, clickupTaskUrl(j.taskId));
    }
    return NextResponse.json({
      renders: renders.map((r) => ({
        ...r,
        uploaded: uploaded[r.renderId] ?? false,
        clickupUrl: clickupByRender.get(r.renderId) ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Toggle a render's "uploaded" flag. Body: { renderId, uploaded }.
export async function POST(req: Request) {
  try {
    const { renderId, uploaded } = await req.json();
    if (!renderId) {
      return NextResponse.json({ error: "renderId required" }, { status: 400 });
    }
    await setUploaded(String(renderId), Boolean(uploaded));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Delete a finished render (discard a take you don't like).
export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key query param required" }, { status: 400 });
  }
  try {
    await deleteRenderObject(key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
