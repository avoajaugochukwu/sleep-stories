"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type JobStatus = "queued" | "running" | "ready" | "failed" | "cancelled";

interface JobSummary {
  taskId: string;
  channel: string | null;
  name: string;
  status: JobStatus;
  progress: string | null;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  clickupUrl: string;
  url: string;
  updatedAt: string;
}

const BADGE: Record<JobStatus, { dot: string; text: string; bar: string; label: string }> = {
  queued: { dot: "bg-muted-foreground/60", text: "text-muted-foreground", bar: "bg-muted-foreground/50", label: "Queued" },
  running: { dot: "bg-primary animate-pulse", text: "text-primary", bar: "bg-primary", label: "Running" },
  ready: { dot: "bg-success", text: "text-success", bar: "bg-success", label: "Ready" },
  failed: { dot: "bg-destructive", text: "text-destructive", bar: "bg-destructive", label: "Failed" },
  cancelled: { dot: "bg-muted-foreground/60", text: "text-muted-foreground", bar: "bg-muted-foreground/50", label: "Cancelled" },
};

const ORDER: JobStatus[] = ["running", "queued", "ready", "failed", "cancelled"];

function relTime(iso: string): string {
  const t = Date.parse(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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
  const badge = BADGE[job.status];
  const active = job.status === "queued" || job.status === "running";
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
              {badge.label}
            </span>
            <span className="text-[11px] text-muted-foreground">{relTime(job.updatedAt)}</span>
          </div>
          <p className="mt-1 break-words text-sm font-medium text-foreground">
            {job.name || job.taskId}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {job.status === "failed" ? job.error || "Failed" : job.progress || badge.label}
          </p>

          {(job.status === "running" || job.total > 0) && (
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
            {job.status === "ready" && (
              <Link
                href={job.url}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Open project →
              </Link>
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
            {(job.status === "failed" || job.status === "cancelled") && (
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

  const counts = ORDER.map((s) => ({ s, n: jobs.filter((j) => j.status === s).length }));

  // Group by channel; channels with active work float to the top.
  const byChannel = new Map<string, JobSummary[]>();
  for (const job of jobs) {
    const key = job.channel || "Unassigned";
    (byChannel.get(key) ?? byChannel.set(key, []).get(key)!).push(job);
  }
  const groups = [...byChannel.entries()]
    .map(([channel, list]) => ({
      channel,
      jobs: [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)),
      active: list.some((j) => j.status === "running" || j.status === "queued"),
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
              <span className={`h-2 w-2 rounded-full ${BADGE[c.s].dot}`} />
              {c.n} {BADGE[c.s].label}
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
          {groups.map((group) => (
            <section key={group.channel} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {group.channel}
                <span className="text-xs font-normal text-muted-foreground">{group.jobs.length}</span>
              </h2>
              {group.jobs.map((job) => (
                <Row key={job.taskId} job={job} refresh={load} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
