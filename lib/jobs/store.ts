// Turso-backed job store for the Baserow/ClickUp → sleep-stories pipeline.
//
// Mirrors footage-collector's store (same libSQL setup, same lifecycle) so the
// two apps stay aligned. One table, `sleep_jobs`, in the shared Turso DB. The
// finished `projectJson` is a WorkflowExport — exactly what the UI's import
// path already consumes.

import { createClient } from "@libsql/client";
import type { WorkflowExport } from "@/lib/utils/workflow-io";

/** Rows are deleted this many days after ClickUp marks the task done (the same
 *  moment the dashboard hides them). */
const DONE_RETENTION_DAYS = 7;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

export type JobStatus = "queued" | "running" | "ready" | "failed" | "cancelled";

export interface SleepJob {
  taskId: string;
  listId: string | null;
  name: string;
  status: JobStatus;
  progress: string | null;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  /** Finished WorkflowExport — the UI hydrates this. Null until ready. */
  projectJson: WorkflowExport | null;
  /** Inputs from Baserow, kept so a job can be re-run/inspected. */
  script: string;
  audioUrl: string | null;
  baserowRowId: number | null;
  /** ClickUp list name (dashboard grouping fallback when no BOARDS entry). */
  listName: string | null;
  clickupStatus: string | null;
  statusCheckedAt: string | null;
  hidden: boolean;
  clickupDoneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sleep_jobs (
      task_id          TEXT PRIMARY KEY,
      list_id          TEXT,
      name             TEXT NOT NULL DEFAULT 'Untitled',
      status           TEXT NOT NULL DEFAULT 'queued',
      progress         TEXT,
      total            INTEGER NOT NULL DEFAULT 0,
      completed        INTEGER NOT NULL DEFAULT 0,
      failed           INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      project_json     TEXT,
      script           TEXT NOT NULL DEFAULT '',
      audio_url        TEXT,
      baserow_row_id   INTEGER,
      list_name        TEXT,
      clickup_status   TEXT,
      status_checked_at TEXT,
      hidden           INTEGER NOT NULL DEFAULT 0,
      clickup_done_at  TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  tableReady = true;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToJob(r: any): SleepJob {
  return {
    taskId: String(r.task_id),
    listId: r.list_id ?? null,
    name: String(r.name ?? "Untitled"),
    status: String(r.status) as JobStatus,
    progress: r.progress ?? null,
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    error: r.error ?? null,
    projectJson: r.project_json ? JSON.parse(String(r.project_json)) : null,
    script: String(r.script ?? ""),
    audioUrl: r.audio_url ?? null,
    baserowRowId: r.baserow_row_id == null ? null : Number(r.baserow_row_id),
    listName: r.list_name ?? null,
    clickupStatus: r.clickup_status ?? null,
    statusCheckedAt: r.status_checked_at ?? null,
    hidden: Number(r.hidden ?? 0) === 1,
    clickupDoneAt: r.clickup_done_at ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getJob(taskId: string): Promise<SleepJob | null> {
  await ensureTable();
  const res = await db.execute({
    sql: "SELECT * FROM sleep_jobs WHERE task_id = ?",
    args: [taskId],
  });
  return res.rows[0] ? rowToJob(res.rows[0]) : null;
}

/** Insert a queued job if absent. Idempotent — safe for the caller to retry. */
export async function createJobIfAbsent(input: {
  taskId: string;
  listId: string | null;
  name: string;
  script: string;
  audioUrl: string | null;
  baserowRowId: number | null;
  listName: string | null;
}): Promise<{ job: SleepJob; created: boolean }> {
  await ensureTable();
  const existing = await getJob(input.taskId);
  if (existing) return { job: existing, created: false };

  await db.execute({
    sql: `INSERT INTO sleep_jobs
            (task_id, list_id, name, status, script, audio_url, baserow_row_id, list_name)
          VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
    args: [
      input.taskId,
      input.listId,
      input.name,
      input.script,
      input.audioUrl,
      input.baserowRowId,
      input.listName,
    ],
  });
  const job = await getJob(input.taskId);
  return { job: job!, created: true };
}

const COLS: Record<string, string> = {
  name: "name",
  status: "status",
  progress: "progress",
  total: "total",
  completed: "completed",
  failed: "failed",
  error: "error",
  projectJson: "project_json",
  clickupStatus: "clickup_status",
  statusCheckedAt: "status_checked_at",
  hidden: "hidden",
  clickupDoneAt: "clickup_done_at",
};

export async function updateJob(
  taskId: string,
  patch: Partial<
    Pick<
      SleepJob,
      | "name"
      | "status"
      | "progress"
      | "total"
      | "completed"
      | "failed"
      | "error"
      | "projectJson"
      | "clickupStatus"
      | "statusCheckedAt"
      | "hidden"
      | "clickupDoneAt"
    >
  >,
): Promise<void> {
  await ensureTable();
  const sets: string[] = [];
  const args: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = COLS[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    if (k === "projectJson") args.push(v ? JSON.stringify(v) : null);
    else if (k === "hidden") args.push(v ? 1 : 0);
    else args.push(v as any);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  args.push(taskId);
  await db.execute({
    sql: `UPDATE sleep_jobs SET ${sets.join(", ")} WHERE task_id = ?`,
    args,
  });
}

/** Jobs shown on the dashboard (not hidden), newest first. */
export async function listVisibleJobs(): Promise<SleepJob[]> {
  await ensureTable();
  const res = await db.execute(
    "SELECT * FROM sleep_jobs WHERE hidden = 0 ORDER BY updated_at DESC",
  );
  return res.rows.map(rowToJob);
}

/** Claim the oldest queued job, flipping it to running. */
export async function claimNextQueuedJob(): Promise<SleepJob | null> {
  await ensureTable();
  const res = await db.execute(
    "SELECT * FROM sleep_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
  );
  const row = res.rows[0];
  if (!row) return null;
  const job = rowToJob(row);
  const upd = await db.execute({
    sql: "UPDATE sleep_jobs SET status = 'running', updated_at = datetime('now') WHERE task_id = ? AND status = 'queued'",
    args: [job.taskId],
  });
  if (upd.rowsAffected === 0) return claimNextQueuedJob();
  return { ...job, status: "running" };
}

/** Re-queue any job left 'running' by a crashed/restarted process. */
export async function requeueRunningJobs(): Promise<number> {
  await ensureTable();
  const res = await db.execute(
    "UPDATE sleep_jobs SET status = 'queued' WHERE status = 'running'",
  );
  return res.rowsAffected ?? 0;
}

/** Drop rows ClickUp marked done more than the retention window ago. */
export async function cleanupExpiredJobs(): Promise<number> {
  await ensureTable();
  const res = await db.execute({
    sql: `DELETE FROM sleep_jobs WHERE clickup_done_at IS NOT NULL
          AND clickup_done_at < datetime('now', ?)`,
    args: [`-${DONE_RETENTION_DAYS} days`],
  });
  return res.rowsAffected ?? 0;
}

export async function deleteJob(taskId: string): Promise<void> {
  await ensureTable();
  await db.execute({ sql: "DELETE FROM sleep_jobs WHERE task_id = ?", args: [taskId] });
}
