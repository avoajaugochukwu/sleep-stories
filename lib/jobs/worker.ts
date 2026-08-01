// In-process background worker for the Baserow/ClickUp → sleep-stories pipeline.
//
// Runs inside the long-lived Next server. Processes one job at a time, mirroring
// what the browser UI does by hand: breakdown script -> generate one image per
// scene -> read audio duration -> kick the Lambda render ->
// store the finished WorkflowExport. Flips ClickUp status as it goes and flags
// the Baserow row when done. Survives restarts by re-queuing interrupted jobs on
// first touch (ensureResumed) — there is no external queue.

import { breakdownScript } from "@/lib/scene-engine/script-to-scenes";
import { generateSceneImage } from "./scene-image";
import { getAudioDurationSec } from "./audio-duration";
import { startRenderForScenes } from "@/lib/remotion/start-render";
import { fetchModalRenderProgress } from "@/lib/render/modal";
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

// Persist storyboard progress this often (in images completed) so a restart
// resumes instead of regenerating from scratch. Each save writes the whole
// WorkflowExport blob, so don't do it per-image.
// ponytail: fixed batch; lower it if restarts are frequent and images are cheap.
const SAVE_EVERY = 20;

/** Build the WorkflowExport stored as the job's project_json — written partially
 *  during processing (the resume checkpoint) and fully once the render starts. */
function buildJobExport(args: {
  script: string;
  audioUrl: string;
  durationSec: number;
  scenes: Scene[];
  storyboard: StoryboardScene[];
  renders: RenderJob[];
  overlayPack?: string;
}): WorkflowExport {
  const { script, audioUrl, durationSec, scenes, storyboard, renders, overlayPack } = args;
  return {
    app: "sleep-stories",
    version: WORKFLOW_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    state: {
      currentStep: 2,
      script: {
        content: script,
        word_count: script.trim().split(/\s+/).length,
        generated_at: new Date(),
      },
      scenes,
      storyboardScenes: storyboard,
      audio: { url: audioUrl, durationSec },
      renders,
      overlayPack,
    },
  };
}

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

    // 1. Script -> no-gap scenes (same mapping the analyze route uses). Reuse a
    //    prior run's breakdown + storyboard if we have one so a restart continues
    //    instead of re-running the LLM and regenerating every image from scratch.
    const prior = job.projectJson?.state;
    let scenes: Scene[];
    let storyboard: StoryboardScene[];
    let overlayPack: string | undefined;
    if (
      prior?.scenes?.length &&
      prior.storyboardScenes?.length === prior.scenes.length
    ) {
      scenes = prior.scenes;
      storyboard = prior.storyboardScenes;
      overlayPack = prior.overlayPack;
      const have = storyboard.filter((s) => s.image_url).length;
      console.log(`[jobs ${taskId}] resuming — ${have}/${scenes.length} images already done`);
    } else {
      const { scenes: broken, genre, overlayPack: pack } = await breakdownScript(job.script);
      overlayPack = pack;
      console.log(`[jobs ${taskId}] genre=${genre} overlays=${pack}`);
      scenes = broken.map((s) => ({
        scene_number: s.scene_number,
        script_snippet: s.script_snippet,
        visual_prompt: s.visual_prompt,
        negative_prompt: s.negative_prompt,
        duration: s.duration,
      }));
      storyboard = scenes.map((s) => ({ ...s, generation_status: "pending" }));
      // Checkpoint the breakdown immediately: a restart before any image still
      // resumes from here rather than re-running the (non-deterministic) LLM.
      await updateJob(taskId, {
        projectJson: buildJobExport({ script: job.script, audioUrl: job.audioUrl, durationSec: 0, scenes, storyboard, renders: [], overlayPack }),
      });
    }
    const total = scenes.length;

    if (await stopIfCancelled("after breakdown")) return;

    // 2. Generate an image for every scene that doesn't already have one.
    //    Bounded concurrency: firing all N at once backs up Modal's queue so the
    //    tail waits past the poll deadline and times out. Cap in-flight requests
    //    to Modal's container capacity. generateSceneImage retries each image; the
    //    general-retry rounds below are the batch-level safety net.
    // ponytail: fixed pool of CONCURRENCY workers; tune IMAGE_GEN_CONCURRENCY to Modal's max_containers.
    const CONCURRENCY = Number(process.env.IMAGE_GEN_CONCURRENCY) || 10;
    const audioUrl = job.audioUrl!; // guarded above
    const filledCount = () => storyboard.filter((s) => s.image_url).length;
    const erroredCount = () =>
      storyboard.filter((s) => s.generation_status === "error").length;
    const missing = () => storyboard.flatMap((s, i) => (s.image_url ? [] : [i]));

    const checkpoint = (durationSec = 0, renders: RenderJob[] = []) =>
      updateJob(taskId, {
        projectJson: buildJobExport({ script: job.script, audioUrl, durationSec, scenes, storyboard, renders, overlayPack }),
      });

    const reportProgress = () =>
      updateJob(taskId, {
        completed: filledCount(),
        failed: erroredCount(),
        progress: `Generating images ${filledCount()}/${total}…`,
      });

    // Fill the given scene indices with a bounded worker pool.
    const fillImages = async (indices: number[]): Promise<void> => {
      let cursor = 0;
      let sinceSave = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const k = cursor++;
          if (k >= indices.length) return;
          const index = indices[k];
          try {
            const { image_url } = await generateSceneImage(scenes[index]);
            storyboard[index] = {
              ...storyboard[index],
              image_url,
              // Deliberately NOT `visual_prompt: prompt_used`. prompt_used is the
              // FINAL prompt, STYLE_PREFIX included; storing it made the field
              // non-idempotent, so every retry round or manual regenerate
              // prepended the prefix again. 77 of 176 scenes in the live Somme
              // job ended up as "highly detailed digital painting, highly
              // detailed digital painting: …". visual_prompt stays the authored
              // prompt; the prefix is applied at generation time, every time.
              generation_status: "completed",
              error_message: undefined,
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
            if (++sinceSave >= SAVE_EVERY) { sinceSave = 0; void checkpoint(); }
            void reportProgress();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indices.length) }, worker));
      await checkpoint(); // flush this pass's images
    };

    await updateJob(taskId, { total, completed: filledCount(), failed: erroredCount(), progress: `Generating images ${filledCount()}/${total}…` });
    await fillImages(missing());

    // General retry: re-attempt only the still-missing images, a couple of rounds.
    // By now the endpoint is warm, so these usually fill.
    // ponytail: 2 rounds; bump GENERAL_RETRY_ROUNDS if failures persist.
    const GENERAL_RETRY_ROUNDS = 2;
    for (let round = 1; round <= GENERAL_RETRY_ROUNDS && missing().length > 0; round++) {
      if (await stopIfCancelled(`before retry ${round}`)) return;
      const gaps = missing();
      await updateJob(taskId, { progress: `Retrying ${gaps.length} image(s) (round ${round}/${GENERAL_RETRY_ROUNDS})…` });
      await fillImages(gaps);
    }

    if (await stopIfCancelled("after images")) return;

    // 3. Gate: never render on top of missing images — that wastes a render on a
    //    broken video. Park the job so the user fixes the images in the project
    //    and renders manually.
    const gaps = missing().length;
    if (gaps > 0) {
      await updateJob(taskId, {
        status: "needs_images",
        projectJson: buildJobExport({ script: job.script, audioUrl, durationSec: 0, scenes, storyboard, renders: [], overlayPack }),
        completed: total - gaps,
        failed: gaps,
        progress: `${gaps} image(s) failed after retries — open project to fix & render`,
        error: null,
      });
      console.warn(`[jobs ${taskId}] needs_images: ${gaps}/${total} missing — render skipped`);
      return; // leave ClickUp in-progress; not done.
    }

    // 4. Audio duration (server-side — no <audio> element here).
    await updateJob(taskId, { progress: "Reading audio duration…" });
    const durationSec = await getAudioDurationSec(audioUrl);

    // 5. Kick the render (fire-and-forget). Reuse a render a prior run already
    //    started (its id is checkpointed in projectJson) so a restart doesn't pay
    //    for a second one. We do NOT wait for it — the finished MP4 lands in S3 at
    //    renders/<renderId>/<slug>.mp4, and the dashboard resolves the download
    //    link from that id on read (see app/api/jobs). Keeps the worker free for
    //    the next job.
    //    A failed render is NOT reusable — the checkpointed `status` is written
    //    once at creation and never updated (state is derived on read), so ask
    //    Modal. A poll that throws also means "start fresh": adopting a render
    //    we can't see the state of is how a retry silently no-ops forever.
    const priorRender = job.projectJson?.state?.renders?.[0];
    let renderJob: RenderJob;
    let reusable = false;
    if (priorRender?.renderId) {
      try {
        const p = await fetchModalRenderProgress(priorRender.renderId);
        reusable = !p.fatalErrorEncountered;
        if (!reusable) {
          console.log(`[jobs ${taskId}] prior render ${priorRender.renderId} failed — re-rendering`);
        }
      } catch (e) {
        console.warn(`[jobs ${taskId}] could not poll ${priorRender.renderId}, re-rendering:`, e);
      }
    }
    if (priorRender?.renderId && reusable) {
      renderJob = priorRender;
      console.log(`[jobs ${taskId}] reusing render ${priorRender.renderId}`);
    } else {
      await updateJob(taskId, { progress: "Starting render…" });
      const render = await startRenderForScenes({
        scenes: storyboard,
        audioUrl,
        audioDurationSec: durationSec,
        title: job.name === "Untitled" ? undefined : job.name,
        overlayPack,
      });
      renderJob = {
        renderId: render.renderId,
        bucketName: render.bucketName,
        title: render.title,
        createdAt: Date.now(),
        status: "rendering",
        progress: 0,
      };
    }

    // 6. Store the finished WorkflowExport + render id — the UI hydrates the
    //    project verbatim, and the dashboard finds the video from the render id.
    const projectJson = buildJobExport({
      script: job.script,
      audioUrl,
      durationSec,
      scenes,
      storyboard,
      renders: [renderJob],
      overlayPack,
    });

    await updateJob(taskId, {
      status: "ready",
      projectJson,
      completed: total,
      failed: 0,
      progress: `Ready — render started (${total}/${total} images)`,
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

    console.log(`[jobs ${taskId}] ready — render ${renderJob.renderId} (${total}/${total} images)`);
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
