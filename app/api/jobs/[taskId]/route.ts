import { NextRequest, NextResponse } from "next/server";
import { deleteJob, getJob, updateJob } from "@/lib/jobs/store";
import { enqueueJob, ensureResumed } from "@/lib/jobs/worker";
import { deriveJobState, type ModalProgress } from "@/lib/jobs/render-state";
import { clickupTaskUrl } from "@/lib/jobs/clickup";
import { listRecentRenders } from "@/lib/aws/s3";
import { fetchModalRenderProgress } from "@/lib/render/modal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET a single job including its finished `projectJson` (a WorkflowExport) once
 * ready, so the page can hydrate it via the import path. Touching it also
 * re-queues interrupted jobs (resume point).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  await ensureResumed();
  const { taskId } = await params;
  const job = await getJob(taskId);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Unlike the list route, ONE job is cheap enough to ask Modal about directly —
  // that is what turns "Rendering" into a real percentage, and a dead render
  // into "Render failed" instead of a bar that never moves. Both lookups are
  // best-effort: a job page must still render when S3 or Modal is unreachable.
  const renderId = job.projectJson?.state?.renders?.[0]?.renderId ?? null;
  let videoUrl: string | null = null;
  let modal: ModalProgress | null = null;
  if (renderId) {
    [videoUrl, modal] = await Promise.all([
      listRecentRenders()
        .then((rs) => rs.find((r) => r.renderId === renderId)?.url ?? null)
        .catch(() => null),
      fetchModalRenderProgress(renderId).catch(() => null),
    ]);
  }

  const derived = deriveJobState(job, videoUrl, modal);

  return NextResponse.json({
    taskId: job.taskId,
    name: job.name,
    status: job.status,
    state: derived.state,
    stateLabel: derived.label,
    stateDetail: derived.detail,
    renderExists: derived.renderExists,
    renderId,
    videoUrl,
    clickupUrl: clickupTaskUrl(job.taskId),
    projectUrl: `/scenes?job=${job.taskId}`,
    progress: job.progress,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    error: job.error,
    projectJson: job.projectJson,
    updatedAt: job.updatedAt,
  });
}

/**
 * POST { action } — control a job:
 *  - "retry"  : re-queue a failed/cancelled job
 *  - "cancel" : stop a queued/running job (cooperative; takes effect at the
 *               next stage boundary)
 *  - "delete" : remove the job row (UI cleanup)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const job = await getJob(taskId);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  switch (body.action) {
    case "retry": {
      await updateJob(taskId, {
        status: "queued",
        error: null,
        progress: "queued",
        hidden: false,
      });
      await ensureResumed();
      await enqueueJob(taskId);
      return NextResponse.json({ ok: true, status: "queued" });
    }
    case "cancel": {
      if (job.status !== "queued" && job.status !== "running") {
        return NextResponse.json({ ok: true, status: job.status });
      }
      await updateJob(taskId, { status: "cancelled", progress: "Cancelling…" });
      return NextResponse.json({ ok: true, status: "cancelled" });
    }
    case "delete": {
      await deleteJob(taskId);
      return NextResponse.json({ ok: true, deleted: true });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}

/** DELETE — remove the job row (UI cleanup). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  await deleteJob(taskId);
  return NextResponse.json({ ok: true, deleted: true });
}
