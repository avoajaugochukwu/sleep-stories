// In-process background worker for the Baserow/ClickUp → sleep-stories pipeline.
//
// Runs inside the long-lived Next server. Processes one job at a time, mirroring
// what the browser UI does by hand: breakdown script -> generate one image per
// scene -> read audio duration -> kick the Lambda render ->
// store the finished WorkflowExport. Flips ClickUp status as it goes and flags
// the Baserow row when done. Survives restarts by re-queuing interrupted jobs on
// first touch (ensureResumed) — there is no external queue.

import { breakdownScript } from "@/lib/scene-engine/no-gap-breakdown";
import { generateSceneImage } from "./scene-image";
import { getAudioDurationSec } from "./audio-duration";
import { startRenderForScenes } from "@/lib/remotion/start-render";
import { WORKFLOW_FILE_VERSION, type WorkflowExport } from "@/lib/utils/workflow-io";
import type { Scene, StoryboardScene, RenderJob } from "@/lib/types";
import { setClickupStatus } from "./clickup";
import { markVideoProcessed } from "./baserow";
import { boardForList, statusInProgressFor, statusDoneFor } from "./config";
import {
  claimNextQueuedJob,
  getJob,
  requeueRunningJobs,
  updateJob,
  type SleepJob,
} from "./store";

let draining = false;
let resumed = false;

async function processJob(job: SleepJob): Promise<void> {
  const { taskId } = job;
  const board = boardForList(job.listId);

  // Cooperative cancellation: the dashboard's Cancel sets status → 'cancelled'.
  const isCancelled = async (): Promise<boolean> =>
    (await getJob(taskId))?.status === "cancelled";
  const stopIfCancelled = async (where: string): Promise<boolean> => {
    if (!(await isCancelled())) return false;
    await updateJob(taskId, { progress: `Cancelled (${where})` });
    console.log(`[jobs ${taskId}] cancelled at ${where}`);
    return true;
  };

  try {
    await updateJob(taskId, { status: "running", progress: "Breaking down script…", error: null });

    if (!job.script.trim()) throw new Error("job has no script");
    if (!job.audioUrl) throw new Error("job has no audioUrl");

    // Best-effort: reflect progress on the ClickUp board.
    try {
      await setClickupStatus(taskId, statusInProgressFor(board));
    } catch (err) {
      console.warn(`[jobs ${taskId}] could not set in-progress:`, err);
    }

    if (await stopIfCancelled("before breakdown")) return;

    // 1. Script -> no-gap scenes (same mapping the analyze route uses).
    const { scenes: broken } = await breakdownScript(job.script);
    const scenes: Scene[] = broken.map((s) => ({
      scene_number: s.scene_number,
      script_snippet: s.script_snippet,
      visual_prompt: s.visual_prompt,
      duration: s.duration,
    }));
    const total = scenes.length;

    if (await stopIfCancelled("after breakdown")) return;

    // 2. Generate a unique image for every scene, in parallel — the self-hosted
    //    image API is cheap, so no pool cap and no overflow reuse. Per-image
    //    failures are tolerated (the render carries the last image forward).
    await updateJob(taskId, { total, completed: 0, failed: 0, progress: `Generating images 0/${total}…` });

    const storyboard: StoryboardScene[] = scenes.map((s) => ({
      ...s,
      generation_status: "pending",
    }));
    let done = 0;

    await Promise.all(
      scenes.map(async (scene, index) => {
        try {
          const { image_url, prompt_used } = await generateSceneImage(scene);
          storyboard[index] = {
            ...storyboard[index],
            image_url,
            visual_prompt: prompt_used,
            generation_status: "completed",
            image_pool_index: index,
          };
        } catch (err) {
          console.error(`[jobs ${taskId}] image ${index} failed:`, err);
          storyboard[index] = {
            ...storyboard[index],
            generation_status: "error",
            error_message: "Failed to generate image",
          };
        } finally {
          done++;
          const filled = storyboard.filter((s) => s.image_url).length;
          void updateJob(taskId, {
            completed: filled,
            failed: done - filled,
            progress: `Generating images ${done}/${total}…`,
          });
        }
      }),
    );

    if (await stopIfCancelled("after images")) return;

    // 3. Audio duration (server-side — no <audio> element here).
    await updateJob(taskId, { progress: "Reading audio duration…" });
    const durationSec = await getAudioDurationSec(job.audioUrl);

    // 4. Kick the Lambda render.
    await updateJob(taskId, { progress: "Starting render…" });
    const render = await startRenderForScenes({
      scenes: storyboard,
      audioUrl: job.audioUrl,
      audioDurationSec: durationSec,
    });

    const renderJob: RenderJob = {
      renderId: render.renderId,
      bucketName: render.bucketName,
      title: render.title,
      createdAt: Date.now(),
      status: "rendering",
      progress: 0,
    };

    // 5. Store the finished WorkflowExport — the UI hydrates this verbatim, so
    //    images + audio persist for re-render and thumbnail picking.
    const projectJson: WorkflowExport = {
      app: "sleep-stories",
      version: WORKFLOW_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      state: {
        currentStep: 2,
        script: {
          content: job.script,
          word_count: job.script.trim().split(/\s+/).length,
          generated_at: new Date(),
        },
        scenes,
        storyboardScenes: storyboard,
        audio: { url: job.audioUrl, durationSec },
        renders: [renderJob],
      },
    };

    const filled = storyboard.filter((s) => s.image_url).length;
    await updateJob(taskId, {
      status: "ready",
      projectJson,
      completed: filled,
      failed: total - filled,
      progress: `Ready — render started (${filled}/${total} images)`,
      error: null,
    });

    // Best-effort: flip ClickUp + flag the Baserow row.
    try {
      const done = statusDoneFor(board);
      await setClickupStatus(taskId, done);
      await updateJob(taskId, { clickupStatus: done });
    } catch (err) {
      console.warn(`[jobs ${taskId}] could not set done status:`, err);
    }
    if (job.baserowRowId) {
      try {
        await markVideoProcessed(job.baserowRowId, "done");
      } catch (err) {
        console.warn(`[jobs ${taskId}] could not flag video_processed:`, err);
      }
    }

    console.log(`[jobs ${taskId}] ready — render ${render.renderId} (${filled}/${total} images)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[jobs ${taskId}] failed:`, message);
    await updateJob(taskId, { status: "failed", error: message, progress: "Failed" });
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const job = await claimNextQueuedJob();
      if (!job) break;
      await processJob(job);
    }
  } catch (err) {
    console.error("[jobs] drain loop error:", err);
  } finally {
    draining = false;
  }
}

/** Kick the worker. Safe to call repeatedly; no-op if already draining. */
export function kickWorker(): void {
  void drain();
}

/** Re-queue interrupted jobs and start draining. Runs at most once per process. */
export async function ensureResumed(): Promise<void> {
  if (resumed) return;
  resumed = true;
  try {
    const n = await requeueRunningJobs();
    if (n > 0) console.log(`[jobs] re-queued ${n} interrupted job(s)`);
  } catch (err) {
    console.error("[jobs] resume failed:", err);
  }
  kickWorker();
}

/** Enqueue an already-created (status 'queued') job for processing. */
export async function enqueueJob(taskId: string): Promise<void> {
  await ensureResumed();
  const job = await getJob(taskId);
  if (job && job.status === "queued") kickWorker();
}
