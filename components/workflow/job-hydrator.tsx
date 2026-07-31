"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { parseWorkflowFile, applyWorkflow } from "@/lib/utils/workflow-io";
import { SessionTools } from "@/components/workflow/session-tools";

type JobState = {
  status: "queued" | "running" | "ready" | "failed" | "needs_images";
  name?: string;
  stateLabel?: string;
  progress: string | null;
  error: string | null;
  projectJson: unknown;
};

/** A ready job already had its render kicked off by the worker (checkpointed in
 *  projectJson). Saying only "ready below" read as "now go press Render", which
 *  bought a second copy of a multi-hour video. */
function renderStarted(projectJson: unknown): boolean {
  const renders = (projectJson as { state?: { renders?: unknown[] } })?.state?.renders;
  return Array.isArray(renders) && renders.length > 0;
}

/**
 * When the page is opened as /scenes?job=<taskId> (the URL the ingest endpoint
 * returns), poll the job and, once ready, load its prebaked workflow into the
 * session via the same import path a manual file upload uses. Renders a small
 * status banner while processing; nothing when there's no ?job.
 */
export function JobHydrator() {
  const jobId = useSearchParams().get("job");
  const [state, setState] = useState<JobState | null>(null);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) {
          if (alive) setState({ status: "failed", progress: null, error: res.status === 404 ? "Job not found." : `Error ${res.status}`, projectJson: null });
          return;
        }
        const job = (await res.json()) as JobState;
        if (!alive) return;
        setState(job);

        // needs_images also carries a project (partial storyboard) so the user
        // can fix the failed images and render manually.
        if (
          (job.status === "ready" || job.status === "needs_images") &&
          job.projectJson &&
          !appliedRef.current
        ) {
          appliedRef.current = true;
          const { state: ws } = parseWorkflowFile(JSON.stringify(job.projectJson));
          applyWorkflow(ws);
          return; // done — stop polling
        }
        if (job.status === "queued" || job.status === "running") {
          timer = setTimeout(poll, 4000);
        }
      } catch (err) {
        if (alive) setState({ status: "failed", progress: null, error: err instanceof Error ? err.message : "Failed to load job", projectJson: null });
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  // No ?job= — the editor is showing whatever the session store happens to hold,
  // which after any prior job is somebody else's scenes with nothing saying so.
  // Say so. This is the whole reason jobs got their own URLs.
  if (!jobId) {
    return (
      <div className="glass-card flex flex-wrap items-center gap-x-3 gap-y-2 p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Manual session</span>
        <span className="text-xs">
          Not linked to a job — nothing here writes back to the queue.
        </span>
        <SessionTools className="ml-auto" />
      </div>
    );
  }

  if (!state) return null;

  const tone =
    state.status === "failed"
      ? "border-destructive/40 text-destructive"
      : state.status === "needs_images"
        ? "border-amber-500/40 text-amber-500"
        : state.status === "ready"
          ? "border-success/40 text-success"
          : "border-border/70 text-muted-foreground";

  return (
    <div className={`glass-card space-y-2 p-4 text-sm ${tone}`}>
      {/* Persistent identity strip. The banner below is about STATUS and can
          settle; this says which job you are editing and never goes away. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 pb-2">
        <span className="truncate font-medium text-foreground">
          {state.name || "Job"}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{jobId}</span>
        <Link
          href={`/jobs/${jobId}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          ← Back to job
        </Link>
        <SessionTools className="ml-auto" />
      </div>
      <div className="flex items-center gap-3">
      {state.status === "failed" || state.status === "needs_images" ? (
        <AlertCircle className="h-5 w-5 shrink-0" />
      ) : state.status === "ready" ? (
        <CheckCircle2 className="h-5 w-5 shrink-0" />
      ) : (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
      )}
      <span>
        {state.status === "failed"
          ? `Prebake failed — ${state.error ?? "unknown error"}`
          : state.status === "needs_images"
            ? "Some images failed — regenerate the missing ones below, then render the full video."
            : state.status === "ready"
              ? renderStarted(state.projectJson)
                ? "Loaded the prebaked workflow — the video is already rendering (started automatically). Check the render step for progress; you don't need to start one."
                : "Loaded the prebaked workflow — scenes, images and audio are ready below."
              : state.progress ?? "Processing…"}
      </span>
      </div>
    </div>
  );
}
