import { NextResponse } from "next/server";
import {
  cleanupExpiredJobs,
  listVisibleJobs,
  updateJob,
  type SleepJob,
} from "@/lib/jobs/store";
import { ensureResumed } from "@/lib/jobs/worker";
import { clickupTaskUrl, getClickupState } from "@/lib/jobs/clickup";
import { deriveJobState } from "@/lib/jobs/render-state";
import { STATUS_COMPLETE, boardForList } from "@/lib/jobs/config";
import { listRecentRenders } from "@/lib/aws/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How long a cached ClickUp state is trusted before we re-check (ms).
const STATUS_TTL_MS = 60_000;
const SETTLED = new Set(["ready", "failed", "cancelled"]);

function isStale(checkedAt: string | null): boolean {
  if (!checkedAt) return true;
  const t = Date.parse(checkedAt.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STATUS_TTL_MS;
}

/**
 * List jobs for the dashboard. Settled jobs are re-checked against ClickUp (at
 * most once per TTL): if the task is marked complete OR deleted in ClickUp, the
 * job is hidden — so the lifecycle is managed in one place (ClickUp).
 */
export async function GET() {
  await ensureResumed();
  await cleanupExpiredJobs().catch((err) =>
    console.error("[jobs] cleanup failed:", err),
  );

  const jobs = await listVisibleJobs();
  const shown: SleepJob[] = [];
  const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);

  for (const job of jobs) {
    if (SETTLED.has(job.status) && isStale(job.statusCheckedAt)) {
      const state = await getClickupState(job.taskId);
      const done =
        !state.exists ||
        (state.status != null &&
          state.status.toLowerCase() === STATUS_COMPLETE.toLowerCase());
      if (done) {
        await updateJob(job.taskId, {
          clickupStatus: state.status,
          statusCheckedAt: nowIso,
          hidden: true,
          clickupDoneAt: nowIso,
        });
        continue;
      }
      await updateJob(job.taskId, {
        clickupStatus: state.status,
        statusCheckedAt: nowIso,
      });
      shown.push({ ...job, clickupStatus: state.status });
      continue;
    }
    shown.push(job);
  }

  // Resolve download links live: match each ready job's render id to the finished
  // MP4 in S3 (keyed renders/<renderId>/…mp4). Read-side only — the worker never
  // waits on the render, so the button just appears once the file exists.
  let renderUrlById = new Map<string, string>();
  if (shown.some((j) => j.status === "ready")) {
    try {
      const renders = await listRecentRenders();
      renderUrlById = new Map(renders.map((r) => [r.renderId, r.url]));
    } catch (err) {
      console.error("[jobs] listRecentRenders failed:", err);
    }
  }

  const summary = shown.map((j) => {
    const renderId = j.projectJson?.state?.renders?.[0]?.renderId;
    const videoUrl = renderId ? renderUrlById.get(renderId) ?? null : null;
    // No Modal progress here on purpose — one Modal call per row on every poll.
    // The per-job page fetches it and gets the finer answer.
    const derived = deriveJobState(j, videoUrl);
    return {
      taskId: j.taskId,
      channel: boardForList(j.listId)?.label ?? j.listName ?? null,
      name: j.name,
      status: j.status,
      // Derived state — the same words the job page shows. Never stored.
      state: derived.state,
      stateLabel: derived.label,
      stateDetail: derived.detail,
      renderExists: derived.renderExists,
      progress: j.progress,
      total: j.total,
      completed: j.completed,
      failed: j.failed,
      error: j.error,
      videoUrl,
      clickupStatus: j.clickupStatus,
      clickupUrl: clickupTaskUrl(j.taskId),
      /** The job's own page. `/scenes?job=` is still the EDIT path (below). */
      url: `/jobs/${j.taskId}`,
      projectUrl: `/scenes?job=${j.taskId}`,
      // createdAt, not updatedAt: every poll writes statusCheckedAt, which bumps
      // updated_at, so the row's time would move on each refresh.
      createdAt: j.createdAt,
    };
  });

  return NextResponse.json({ jobs: summary, count: summary.length });
}
