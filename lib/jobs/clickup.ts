// ClickUp helpers: read a task's state and write status back. The script/audio
// are NOT read from ClickUp — they come from Baserow (see baserow.ts). ClickUp
// is only the status board.

const API_BASE = "https://api.clickup.com/api/v2";

function authHeader(): Record<string, string> {
  const key = process.env.CLICKUP_API;
  if (!key) throw new Error("CLICKUP_API not configured");
  return { Authorization: key };
}

/** Set the ClickUp task status. Label must exist on the list. */
export async function setClickupStatus(
  taskId: string,
  status: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/task/${taskId}`, {
    method: "PUT",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ClickUp status update failed (${res.status}): ${body.slice(0, 200)}`
    );
  }
}

/**
 * Read a task's current state. Distinguishes a deleted task (404 → not found)
 * from a transient error (treated as "unknown", so we never hide on a blip).
 */
export async function getClickupState(
  taskId: string
): Promise<{ exists: boolean; status: string | null }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/task/${taskId}`, { headers: authHeader() });
  } catch {
    return { exists: true, status: null }; // network blip — unknown
  }
  if (res.status === 404) return { exists: false, status: null };
  if (!res.ok) return { exists: true, status: null }; // transient — unknown
  const d = (await res.json()) as { status?: { status?: string } };
  return { exists: true, status: d.status?.status ?? null };
}

/** Read a task's list name (for the dashboard channel grouping). Best-effort:
 *  null on any error or a task with no list. */
export async function getClickupListName(taskId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/task/${taskId}`, { headers: authHeader() });
    if (!res.ok) return null;
    const d = (await res.json()) as { list?: { name?: string } };
    return d.list?.name?.trim() || null;
  } catch {
    return null;
  }
}

/** Build the public ClickUp task URL. */
export function clickupTaskUrl(taskId: string): string {
  return `https://app.clickup.com/t/${taskId}`;
}
