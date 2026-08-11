// Per-render persistent flags, keyed by the S3 renderId (the folder segment in
// renders/<renderId>/<file>.mp4). The /renders list itself is pure S3; this is
// the only DB state it has — a manual "uploaded to YouTube" checkbox. Kept in
// its own table because renders outlive (and mostly never had) a sleep_jobs row.
import { db } from "@/lib/db";

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS render_meta (
      render_id TEXT PRIMARY KEY,
      uploaded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    )
  `);
  tableReady = true;
}

/** renderId -> uploaded, for every render that has ever been toggled. */
export async function getUploadedMap(): Promise<Record<string, boolean>> {
  await ensureTable();
  const { rows } = await db.execute("SELECT render_id, uploaded FROM render_meta WHERE uploaded = 1");
  const map: Record<string, boolean> = {};
  for (const r of rows) map[String(r.render_id)] = true;
  return map;
}

export async function setUploaded(renderId: string, uploaded: boolean): Promise<void> {
  await ensureTable();
  await db.execute({
    sql: `INSERT INTO render_meta (render_id, uploaded, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (render_id) DO UPDATE SET uploaded = excluded.uploaded, updated_at = excluded.updated_at`,
    args: [renderId, uploaded ? 1 : 0, new Date().toISOString()],
  });
}
