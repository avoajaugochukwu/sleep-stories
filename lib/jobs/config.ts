// Configuration for the Baserow/ClickUp → sleep-stories pipeline.
//
// Mirrors footage-collector's config so the two apps stay aligned. ClickUp is
// only the status board (script + audio come from the ingest payload). Add new
// boards here; each maps a ClickUp list to a human label and (optionally) its
// own status names.

export interface BoardConfig {
  /** ClickUp list id */
  listId: string;
  /** Human label (for logs / dashboard grouping) */
  label: string;
  /** ClickUp status set when the worker starts (board override → global). */
  statusInProgress?: string;
  /** ClickUp status set when the render is kicked off (board override → global). */
  statusDone?: string;
}

export const BOARDS: Record<string, BoardConfig> = {
  // The sleep-stories board. ClickUp calls this list **Midnight Mysteries** —
  // the label here used to read "Sleep Stories", which cost a search to
  // reconcile. There is no separate space/cosmos list: the only other candidate,
  // "Space Cluster" (901113798933), is footage-collector's WW2 board despite the
  // name. A second genre rides on this same list via the ingest payload.
  // https://app.clickup.com/9011731879/v/l/li/901113872792
  "901113872792": {
    listId: "901113872792",
    label: "Midnight Mysteries",
  },
};

export function boardForList(listId: string | null | undefined): BoardConfig | null {
  if (!listId) return null;
  return BOARDS[listId] ?? null;
}

// --- ClickUp status labels -------------------------------------------------
// Global defaults; a board may override. ClickUp matches on the lowercased
// label, and the label must exist on the list (otherwise the writeback no-ops
// — footage/render still lands). Override per-deploy via env.
export const STATUS_IN_PROGRESS =
  process.env.CLICKUP_STATUS_IN_PROGRESS || "in progress";
// ⚠️ VERIFIED BROKEN 2026-07-31, left alone deliberately. The Midnight Mysteries
// list has exactly three statuses — `to do`, `in progress`, `complete` — so
// "fc done" does not exist on it and this writeback silently no-ops (it is
// best-effort and caught, so nothing fails). Effect: a job whose render has
// started still reads "in progress" in ClickUp until a human sets it complete.
// Not changed here because picking a real status changes YOUR ClickUp workflow,
// which is not a call this file should make on its own. Either set
// CLICKUP_STATUS_DONE to a status that exists, or add "fc done" to the list.
export const STATUS_DONE = process.env.CLICKUP_STATUS_DONE || "fc done";
/** Status that means "human is finished — hide from the dashboard". */
export const STATUS_COMPLETE =
  process.env.CLICKUP_STATUS_COMPLETE || "complete";

export function statusInProgressFor(board: BoardConfig | null): string {
  return board?.statusInProgress || STATUS_IN_PROGRESS;
}
export function statusDoneFor(board: BoardConfig | null): string {
  return board?.statusDone || STATUS_DONE;
}

export const INGEST_SECRET = process.env.INGEST_SECRET || "";
