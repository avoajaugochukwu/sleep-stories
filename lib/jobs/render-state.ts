// The single place that decides what a job's state IS.
//
// Both the queue list (`/api/jobs`) and the per-job page (`/api/jobs/[taskId]`)
// call this, so a row and its page can never disagree. That mattered enough to
// centralise: the old queue showed a finished-prebake job as "Ready", which
// reads as "ready for YOU to render" — and the render had in fact already been
// started automatically. One click there bought a second copy of a multi-hour
// video (CHANGELOG 2026-07-30).
//
// Derived on READ, never stored. A stored copy goes stale the moment Modal
// finishes, and nothing writes back to the row after the worker lets go.

import type { ModalProgress as ModalRenderProgress } from "@/lib/render/modal";
import type { SleepJob } from "./store";

export type RenderState =
  | "queued"
  | "generating"
  | "needs_images"
  | "needs_render"
  | "rendering"
  | "rendered"
  | "render_failed"
  | "failed"
  | "cancelled";

export interface JobState {
  state: RenderState;
  /** Short label. Same words in the queue row and on the job page. */
  label: string;
  /** One line of detail — progress text, error, or what to do next. */
  detail: string;
  /** True when starting a render would duplicate one that exists. */
  renderExists: boolean;
  renderId: string | null;
  videoUrl: string | null;
}

/** Modal progress, when the caller has bothered to fetch it (the job page does;
 *  the list does not — it would be one Modal call per row). Reuses the renderer
 *  client's own type so the two can't drift; `Partial` because this module only
 *  reads three of its fields. */
export type ModalProgress = Partial<ModalRenderProgress>;

const LABEL: Record<RenderState, string> = {
  queued: "Queued",
  generating: "Generating images",
  needs_images: "Needs images",
  needs_render: "Not rendered",
  rendering: "Rendering",
  rendered: "Rendered",
  render_failed: "Render failed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Modal types its `errors` as `unknown[]` — narrow it here rather than trusting
 *  a shape the renderer never promised. */
function modalErrorMessage(modal: ModalProgress): string | null {
  const first = modal.errors?.[0];
  if (first && typeof first === "object" && "message" in first) {
    const m = (first as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return null;
}

export function deriveJobState(
  job: Pick<
    SleepJob,
    "status" | "progress" | "error" | "total" | "completed" | "failed" | "projectJson"
  >,
  videoUrl: string | null = null,
  modal?: ModalProgress | null,
): JobState {
  const render = job.projectJson?.state?.renders?.[0] ?? null;
  const renderId = render?.renderId ?? null;

  const base = { renderId, videoUrl };

  switch (job.status) {
    case "failed":
      return { ...base, state: "failed", label: LABEL.failed, detail: job.error || "Failed", renderExists: false };
    case "cancelled":
      return { ...base, state: "cancelled", label: LABEL.cancelled, detail: "Cancelled", renderExists: false };
    case "needs_images":
      return {
        ...base,
        state: "needs_images",
        label: LABEL.needs_images,
        detail:
          job.progress ||
          `${job.failed} image(s) failed after retries — fix them in the project, then render`,
        renderExists: false,
      };
    case "queued":
      return { ...base, state: "queued", label: LABEL.queued, detail: job.progress || "Waiting to start", renderExists: false };
    case "running":
      return {
        ...base,
        state: "generating",
        label: LABEL.generating,
        detail: job.progress || "Working",
        renderExists: false,
      };
  }

  // status === 'ready'. The worker sets this the moment it HANDS OFF to Modal —
  // it never waits — so 'ready' alone says nothing about the video.
  if (!renderId) {
    // Unreachable via the worker (it only flips to ready after starting a
    // render), but a hand-imported project lands here. The one state where
    // clicking Render is the right move.
    return { ...base, state: "needs_render", label: LABEL.needs_render, detail: "Images are done; no render has been started", renderExists: false };
  }

  if (modal?.fatalErrorEncountered) {
    return {
      ...base,
      state: "render_failed",
      label: LABEL.render_failed,
      detail: modalErrorMessage(modal) || "Render failed on Modal",
      renderExists: false, // the only state where rendering again is correct
    };
  }

  // The MP4 landing in S3 is the one signal that is true without asking Modal.
  if (videoUrl) {
    return { ...base, state: "rendered", label: LABEL.rendered, detail: "Video is ready", renderExists: true };
  }

  // ponytail: without Modal progress this reads "Rendering" until the MP4
  // appears — a render that dies on Modal looks stuck rather than failed. The
  // job page passes `modal` and gets the real answer; the list deliberately does
  // not, because that would be one Modal call per row on every poll.
  const pct = modal?.overallProgress != null ? ` — ${Math.round(modal.overallProgress * 100)}%` : "";
  return {
    ...base,
    state: "rendering",
    label: LABEL.rendering,
    detail: `Started automatically${pct}. You don't need to do anything.`,
    renderExists: true,
  };
}
