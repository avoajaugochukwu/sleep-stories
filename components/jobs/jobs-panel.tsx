"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { STATE_ORDER, STATE_STYLE, type RenderState } from "./state-style";

/** Collapsed channel sections persist across reloads, keyed by channel label. */
const COLLAPSE_KEY = "jobs-collapsed-channels";

type JobStatus = "queued" | "running" | "ready" | "failed" | "cancelled" | "needs_images";

interface JobSummary {
  /** Null for a finished render whose job row is gone (headless leftover). */
  taskId: string | null;
  /** The S3 render id, when a video exists. Keys the "uploaded" flag. */
  renderId: string | null;
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
  /** Public S3 URL — opens the video in the browser ("Watch"). */
  videoUrl: string | null;
  /** Presigned attachment URL — forces a download ("MP4"). */
  downloadUrl: string | null;
  /** S3 object key, for deleting the render. */
  renderKey: string | null;
  uploaded: boolean;
  clickupUrl: string | null;
  /** The job's own page. Null for a headless-render leftover. */
  url: string | null;
  /** The editor, for viewing the project or fixing images by hand. */
  projectUrl: string | null;
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

function Row({
  job,
  refresh,
  onToggleUploaded,
  onDeleteRender,
}: {
  job: JobSummary;
  refresh: () => void;
  onToggleUploaded: (job: JobSummary, next: boolean) => void;
  onDeleteRender: (job: JobSummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const badge = STATE_STYLE[job.state];
  const active = job.state === "queued" || job.state === "generating";
  const pct = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
  // Viewing the project is safe once the job is settled; while it's still
  // generating/queued/rendering the editor's Render button could buy a second
  // copy, so we keep the link out until then (CHANGELOG 2026-07-30).
  const canOpenProject =
    !!job.projectUrl && !active && job.state !== "rendering";

  const act = (action: "retry" | "cancel", confirmMsg?: string) => async () => {
    if (!job.taskId) return;
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
          {job.url ? (
            <Link
              href={job.url}
              className="mt-1 block break-words text-sm font-medium text-foreground hover:underline"
            >
              {job.name || job.taskId}
            </Link>
          ) : (
            <p className="mt-1 block break-words text-sm font-medium text-foreground">
              {job.name || job.renderId}
            </p>
          )}
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
            {job.url && (
              <Link
                href={job.url}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Open job →
              </Link>
            )}
            {/* Watch (browser) and MP4 (download) are split — you almost always
                want to eyeball the take before saving it. */}
            {job.videoUrl && (
              <a
                href={job.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-success/50 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/10"
              >
                Watch ▷
              </a>
            )}
            {job.downloadUrl && (
              <a
                href={job.downloadUrl}
                download={`${job.name || "render"}.mp4`}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary/50"
              >
                MP4 ↓
              </a>
            )}
            {canOpenProject && (
              <Link
                href={job.projectUrl!}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary/50"
              >
                {job.state === "needs_images" || job.state === "needs_render"
                  ? "Open project to fix →"
                  : "Open project →"}
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
            {job.renderKey && (
              <button
                onClick={() => onDeleteRender(job)}
                className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Delete
              </button>
            )}

            <div className="ml-auto flex items-center gap-3">
              {job.renderId && job.videoUrl && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={job.uploaded}
                    onChange={() => onToggleUploaded(job, !job.uploaded)}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                  Uploaded
                </label>
              )}
              {job.clickupUrl && (
                <a
                  href={job.clickupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  ClickUp ↗
                </a>
              )}
            </div>
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

  // Optimistic render-meta edits (uploaded flag + delete). Keyed by renderId /
  // renderKey — these live in S3 + render_meta, not the sleep_jobs row.
  const toggleUploaded = useCallback((job: JobSummary, next: boolean) => {
    if (!job.renderId) return;
    setJobs((js) =>
      js.map((j) => (j.renderId === job.renderId ? { ...j, uploaded: next } : j)),
    );
    fetch("/api/renders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renderId: job.renderId, uploaded: next }),
    }).catch(() => load());
  }, [load]);

  const removeRender = useCallback((job: JobSummary) => {
    if (!job.renderKey) return;
    if (!window.confirm("Delete this render? The MP4 is removed from S3 for good.")) return;
    setJobs((js) => js.filter((j) => j.renderKey !== job.renderKey));
    fetch(`/api/renders?key=${encodeURIComponent(job.renderKey)}`, {
      method: "DELETE",
    }).catch(() => load());
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
          Nothing here yet. Jobs appear automatically when Baserow sends one, and
          their finished videos stay for 7 days — grouped by channel — so you can
          watch, download, or reopen the project.
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
                    <Row
                      key={job.taskId ?? job.renderId}
                      job={job}
                      refresh={load}
                      onToggleUploaded={toggleUploaded}
                      onDeleteRender={removeRender}
                    />
                  ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
