import { NextRequest, NextResponse } from "next/server";
import { createJobIfAbsent } from "@/lib/jobs/store";
import { enqueueJob } from "@/lib/jobs/worker";
import { INGEST_SECRET, boardForList } from "@/lib/jobs/config";
import { getClickupListName } from "@/lib/jobs/clickup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ingest endpoint for Baserow/n8n — same shape as footage-collector's
 * /api/jobs/ingest so a single automation can fan out to both apps. Idempotent:
 * calling twice for the same taskId never duplicates work.
 *
 * Auth: shared secret in the `x-ingest-secret` header.
 *
 * Body: { taskId, listId?, script, audioUrl, name?, baserowRowId? }
 *   - script   (required) the narration text, used verbatim.
 *   - audioUrl (required here) the narration audio S3 URL — the render needs it.
 */
export async function POST(req: NextRequest) {
  if (!INGEST_SECRET) {
    return NextResponse.json(
      { error: "ingest not configured (missing INGEST_SECRET)" },
      { status: 503 },
    );
  }
  if (req.headers.get("x-ingest-secret") !== INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    taskId?: string;
    listId?: string;
    script?: string;
    audioUrl?: string;
    name?: string;
    baserowRowId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const taskId = (body.taskId || "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  const script = typeof body.script === "string" ? body.script : "";
  if (!script.trim()) {
    return NextResponse.json({ error: "script is required" }, { status: 400 });
  }
  const audioUrl = typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
  if (!audioUrl) {
    return NextResponse.json({ error: "audioUrl is required" }, { status: 400 });
  }

  const listId = body.listId?.trim() || null;
  const board = boardForList(listId);
  const name = (typeof body.name === "string" && body.name.trim()) || "Untitled";
  const baserowRowId =
    typeof body.baserowRowId === "number" ? body.baserowRowId : null;
  // No BOARDS entry → grab the ClickUp list name so the dashboard groups this
  // by name instead of "Unassigned". Best-effort.
  const listName = !board && listId ? await getClickupListName(taskId) : null;

  try {
    const { job, created } = await createJobIfAbsent({
      taskId,
      listId,
      name,
      script,
      audioUrl,
      baserowRowId,
      listName,
    });
    if (created) await enqueueJob(taskId);
    return NextResponse.json({
      ok: true,
      taskId,
      created,
      status: job.status,
      url: `/scenes?job=${taskId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    console.error("[jobs/ingest] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
