import { NextResponse } from "next/server";
import {
  cleanupExpiredJobs,
  listAllJobs,
  listVisibleJobs,
  updateJob,
  type SleepJob,
} from "@/lib/jobs/store";
import { ensureResumed } from "@/lib/jobs/worker";
import { clickupTaskUrl, getClickupState } from "@/lib/jobs/clickup";
import { deriveJobState } from "@/lib/jobs/render-state";
import { STATUS_COMPLETE, boardForList } from "@/lib/jobs/config";
import { listRecentRenders, type RenderListing } from "@/lib/aws/s3";
import { getUploadedMap } from "@/lib/jobs/render-meta";

function channelOf(job: Pick<SleepJob, "listId" | "listName">): string | null {
  return boardForList(job.listId)?.label ?? job.listName ?? null;
}

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

  // The merged queue also carries every finished render (the /renders screen is
  // gone). Load the S3 renders once, plus every job row — including hidden ones —
  // so a render whose job was hidden after ClickUp marked it complete can still
  // link back to its ClickUp task and project.
  let renders: RenderListing[] = [];
  let uploaded: Record<string, boolean> = {};
  let allJobs: SleepJob[] = [];
  try {
    [renders, uploaded, allJobs] = await Promise.all([
      listRecentRenders(),
      getUploadedMap().catch(() => ({})),
      listAllJobs().catch(() => []),
    ]);
  } catch (err) {
    console.error("[jobs] listRecentRenders failed:", err);
  }
  const renderById = new Map(renders.map((r) => [r.renderId, r]));
  // renderId -> the job that produced it (visible or hidden), for re-attaching.
  const jobByRenderId = new Map<string, SleepJob>();
  for (const j of allJobs) {
    const rid = j.projectJson?.state?.renders?.[0]?.renderId;
    if (rid) jobByRenderId.set(rid, j);
  }

  const ownedByShown = new Set<string>();
  const jobRows = shown.map((j) => {
    const renderId = j.projectJson?.state?.renders?.[0]?.renderId ?? null;
    if (renderId) ownedByShown.add(renderId);
    const render = renderId ? renderById.get(renderId) : undefined;
    const videoUrl = render?.url ?? null;
    // No Modal progress here on purpose — one Modal call per row on every poll.
    // The per-job page fetches it and gets the finer answer.
    const derived = deriveJobState(j, videoUrl);
    return {
      taskId: j.taskId,
      renderId,
      channel: channelOf(j),
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
      downloadUrl: render?.downloadUrl ?? null,
      renderKey: render?.key ?? null,
      uploaded: renderId ? uploaded[renderId] ?? false : false,
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

  // Finished renders with no visible job row of their own — a completed job
  // that ClickUp hid, or a headless render whose row is gone. Re-attach to the
  // hidden job when we can, so ClickUp + project links survive; else Unassigned.
  const renderRows = renders
    .filter((r) => !ownedByShown.has(r.renderId))
    .map((r) => {
      const job = jobByRenderId.get(r.renderId);
      return {
        taskId: job?.taskId ?? null,
        renderId: r.renderId,
        channel: job ? channelOf(job) : null,
        name: r.name,
        status: "ready" as const,
        state: "rendered" as const,
        stateLabel: "Rendered",
        stateDetail: "Video is ready",
        renderExists: true,
        progress: null,
        total: 0,
        completed: 0,
        failed: 0,
        error: null,
        videoUrl: r.url,
        downloadUrl: r.downloadUrl,
        renderKey: r.key,
        uploaded: uploaded[r.renderId] ?? false,
        clickupStatus: null,
        clickupUrl: job ? clickupTaskUrl(job.taskId) : null,
        url: job ? `/jobs/${job.taskId}` : null,
        projectUrl: job ? `/scenes?job=${job.taskId}` : null,
        createdAt: r.createdAt,
      };
    });

  const summary = [...jobRows, ...renderRows];
  return NextResponse.json({ jobs: summary, count: summary.length });
}
