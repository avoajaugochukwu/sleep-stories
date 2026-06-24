"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { parseWorkflowFile, applyWorkflow } from "@/lib/utils/workflow-io";

type JobState = {
  status: "queued" | "running" | "ready" | "failed";
  progress: string | null;
  error: string | null;
  projectJson: unknown;
};

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

        if (job.status === "ready" && job.projectJson && !appliedRef.current) {
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

  if (!jobId || !state) return null;

  const tone =
    state.status === "failed"
      ? "border-destructive/40 text-destructive"
      : state.status === "ready"
        ? "border-success/40 text-success"
        : "border-border/70 text-muted-foreground";

  return (
    <div className={`glass-card flex items-center gap-3 p-4 text-sm ${tone}`}>
      {state.status === "failed" ? (
        <AlertCircle className="h-5 w-5 shrink-0" />
      ) : state.status === "ready" ? (
        <CheckCircle2 className="h-5 w-5 shrink-0" />
      ) : (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
      )}
      <span>
        {state.status === "failed"
          ? `Prebake failed — ${state.error ?? "unknown error"}`
          : state.status === "ready"
            ? "Loaded the prebaked workflow — scenes, images and render are ready below."
            : state.progress ?? "Processing…"}
      </span>
    </div>
  );
}
