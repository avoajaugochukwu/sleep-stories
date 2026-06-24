import { NextResponse } from "next/server";
import {
  cleanupExpiredJobs,
  listVisibleJobs,
  updateJob,
  type SleepJob,
} from "@/lib/jobs/store";
import { ensureResumed } from "@/lib/jobs/worker";
import { clickupTaskUrl, getClickupState } from "@/lib/jobs/clickup";
import { STATUS_COMPLETE, boardForList } from "@/lib/jobs/config";

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

  const summary = shown.map((j) => ({
    taskId: j.taskId,
    channel: boardForList(j.listId)?.label ?? j.listName ?? null,
    name: j.name,
    status: j.status,
    progress: j.progress,
    total: j.total,
    completed: j.completed,
    failed: j.failed,
    error: j.error,
    clickupStatus: j.clickupStatus,
    clickupUrl: clickupTaskUrl(j.taskId),
    url: `/scenes?job=${j.taskId}`,
    updatedAt: j.updatedAt,
  }));

  return NextResponse.json({ jobs: summary, count: summary.length });
}
