"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { STATE_ORDER, STATE_STYLE, type RenderState } from "./state-style";

/** Collapsed channel sections persist across reloads, keyed by channel label. */
const COLLAPSE_KEY = "jobs-collapsed-channels";

type JobStatus = "queued" | "running" | "ready" | "failed" | "cancelled" | "needs_images";

interface JobSummary {
  taskId: string;
  channel: string | null;
  name: string;
  status: JobStatus;
  /** Derived server-side (lib/jobs/render-state.ts) — the same words the job
   *  page shows. `status` alone can't tell "rendering" from "rendered": the
   *  worker sets `ready` the moment it hands off to Modal. */
  state: RenderState;
  stateLabel: string;
  stateDetail: string;
  renderExists: boolean;
  progress: string | null;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  videoUrl: string | null;
  clickupUrl: string;
  /** The job's own page. */
  url: string;
  /** The editor, for fixing images and re-rendering by hand. */
  projectUrl: string;
  createdAt: string;
}

/** "01 Aug 2026 04:13" in the viewer's timezone — absolute, so rows can be ordered by eye. */
function stamp(iso: string): string {
  const t = Date.parse(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  return new Date(t)
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
}

async function jobAction(taskId: string, action: "retry" | "cancel") {
  await fetch(`/api/jobs/${taskId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

function Row({ job, refresh }: { job: JobSummary; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const badge = STATE_STYLE[job.state];
  const active = job.state === "queued" || job.state === "generating";
  const pct = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;

  const act = (action: "retry" | "cancel", confirmMsg?: string) => async () => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    await jobAction(job.taskId, action);
    setBusy(false);
    refresh();
  };

  return (
    <div className="glass-card p-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${badge.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold uppercase tracking-wide ${badge.text}`}>
              {job.stateLabel}
            </span>
            <span className="text-[11px] text-muted-foreground">{stamp(job.createdAt)}</span>
          </div>
          <Link
            href={job.url}
            className="mt-1 block break-words text-sm font-medium text-foreground hover:underline"
          >
            {job.name || job.taskId}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">{job.stateDetail}</p>

          {(active || job.total > 0) && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
                <div className={`h-full rounded-full transition-all ${badge.bar}`} style={{ width: `${pct}%` }} />
              </div>
              {job.total > 0 && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {job.completed}/{job.total}
                </span>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={job.url}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              Open job →
            </Link>
            {/* The editor is where the Render button lives, so it stays a
                secondary action and is only offered when a human genuinely has
                something to fix. Never for a job that is already rendering. */}
            {(job.state === "needs_images" || job.state === "needs_render") && (
              <Link
                href={job.projectUrl}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary/50"
              >
                Open project to fix →
              </Link>
            )}
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
            {active && (
              <button
                disabled={busy}
                onClick={act("cancel", "Cancel this job? It stops at the next stage; progress so far is kept.")}
                className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {busy ? "…" : "Cancel"}
              </button>
            )}
            {(job.state === "failed" ||
              job.state === "cancelled" ||
              job.state === "needs_images" ||
              job.state === "render_failed") && (
              <button
                disabled={busy}
                onClick={act("retry")}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/50 disabled:opacity-50"
              >
                {busy ? "…" : "Retry"}
              </button>
            )}
            <a
              href={job.clickupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              ClickUp ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JobsPanel() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: JobSummary[] };
      setJobs(data.jobs);
    } catch {
      /* transient */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Collapsed channel sections, restored from localStorage so they stay closed
  // across reloads. Keyed by channel label (mirrors the military /tasks queue).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore malformed storage */
    }
  }, []);
  const toggleChannel = useCallback((channel: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Chip labels come from the jobs themselves, not a local map — the server owns
  // what a state is called (lib/jobs/render-state.ts) and this keeps one copy.
  const counts = STATE_ORDER.map((s) => {
    const inState = jobs.filter((j) => j.state === s);
    return { s, n: inState.length, label: inState[0]?.stateLabel ?? s };
  });

  // Group by channel; channels with active work float to the top.
  const byChannel = new Map<string, JobSummary[]>();
  for (const job of jobs) {
    const key = job.channel || "Unassigned";
    (byChannel.get(key) ?? byChannel.set(key, []).get(key)!).push(job);
  }
  const groups = [...byChannel.entries()]
    .map(([channel, list]) => ({
      channel,
      jobs: [...list].sort(
        (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
      ),
      // "Active" now includes rendering — a channel with a render in flight is
      // still working, and burying it reads as finished.
      active: list.some(
        (j) => j.state === "generating" || j.state === "queued" || j.state === "rendering",
      ),
    }))
    .sort((a, b) => {
      if (a.channel === "Unassigned") return 1;
      if (b.channel === "Unassigned") return -1;
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.channel.localeCompare(b.channel);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {counts
          .filter((c) => c.n > 0)
          .map((c) => (
            <span
              key={c.s}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              <span className={`h-2 w-2 rounded-full ${STATE_STYLE[c.s].dot}`} />
              {c.n} {c.label}
            </span>
          ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          live
        </span>
      </div>

      {!loaded ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
          Loading jobs…
        </p>
      ) : jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
          No active jobs. They appear automatically when Baserow sends one, and
          disappear once marked complete (or deleted) in ClickUp.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.channel);
            return (
              <section key={group.channel} className="space-y-3">
                <button
                  type="button"
                  onClick={() => toggleChannel(group.channel)}
                  className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                >
                  <span className="w-3 shrink-0 text-xs text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
                  {group.channel}
                  <span className="text-xs font-normal text-muted-foreground">{group.jobs.length}</span>
                </button>
                {!isCollapsed &&
                  group.jobs.map((job) => (
                    <Row key={job.taskId} job={job} refresh={load} />
                  ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
