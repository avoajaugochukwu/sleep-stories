"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { STATE_STYLE, type RenderState } from "./state-style";

interface JobDetail {
  taskId: string;
  name: string;
  state: RenderState;
  stateLabel: string;
  stateDetail: string;
  renderExists: boolean;
  renderId: string | null;
  videoUrl: string | null;
  clickupUrl: string;
  projectUrl: string;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  updatedAt: string;
}

/** States worth re-polling. A rendered/failed/cancelled job will not change on
 *  its own, so the page stops asking. */
const LIVE: RenderState[] = ["queued", "generating", "rendering"];

/**
 * One job, at its own URL. Deliberately does NOT touch the session store — the
 * editor's global state is what made the old `/scenes?job=` flow race its own
 * IndexedDB rehydrate. This page only reads.
 */
export function JobDetail({ taskId }: { taskId: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${taskId}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 404 ? "Job not found — it may have been deleted or aged out." : `Error ${res.status}`);
        return;
      }
      setJob((await res.json()) as JobDetail);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load job");
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!job || !LIVE.includes(job.state)) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [job, load]);

  const act = (action: "retry" | "cancel", confirmMsg?: string) => async () => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    await fetch(`/api/jobs/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    void load();
  };

  if (error) {
    return (
      <div className="glass-card p-6 text-sm text-destructive">
        {error}
        <div className="mt-4">
          <Link href="/jobs" className="text-xs font-medium text-primary hover:underline">
            ← Back to the queue
          </Link>
        </div>
      </div>
    );
  }

  if (!job) {
    return <div className="glass-card p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const style = STATE_STYLE[job.state];
  const pct = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
  const active = job.state === "queued" || job.state === "generating";

  return (
    <div className="space-y-5">
      <div className={`glass-card p-6 ${style.border}`}>
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
          <div className="min-w-0 flex-1">
            <span className={`text-xs font-semibold uppercase tracking-wide ${style.text}`}>
              {job.stateLabel}
            </span>
            <h2 className="mt-1 break-words font-display text-xl">{job.name || job.taskId}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{job.stateDetail}</p>

            {(active || job.total > 0) && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
                  <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${pct}%` }} />
                </div>
                {job.total > 0 && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {job.completed}/{job.total}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {job.videoUrl && (
            <a
              href={job.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-success/50 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/10"
            >
              Download video ↓
            </a>
          )}
          <Link
            href={job.projectUrl}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary/50"
          >
            Open project to edit →
          </Link>
          {active && (
            <button
              disabled={busy}
              onClick={act("cancel", "Cancel this job? It stops at the next stage; progress so far is kept.")}
              className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {busy ? "…" : "Cancel"}
            </button>
          )}
          {(job.state === "failed" || job.state === "cancelled" || job.state === "needs_images" || job.state === "render_failed") && (
            <button
              disabled={busy}
              onClick={act("retry")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50"
            >
              {busy ? "…" : "Retry"}
            </button>
          )}
          <a
            href={job.clickupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            ClickUp ↗
          </a>
        </div>
      </div>

      {/* The point of the whole page: never let someone pay for a render twice. */}
      {job.renderExists && (
        <p className="px-1 text-xs text-muted-foreground">
          This video&rsquo;s render was started automatically when the job finished
          generating images. Opening the project to render again bills a second
          Modal render — only do that if this take is unusable.
        </p>
      )}

      {job.error && job.state !== "failed" && (
        <p className="px-1 text-xs text-destructive">{job.error}</p>
      )}

      <div className="px-1 text-[11px] text-muted-foreground">
        <Link href="/jobs" className="text-primary hover:underline">
          ← Back to the queue
        </Link>
        <span className="ml-3 font-mono">{job.taskId}</span>
        {job.renderId && <span className="ml-3 font-mono">render {job.renderId}</span>}
      </div>
    </div>
  );
}
