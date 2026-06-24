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
  // The Sleep Stories board.
  // https://app.clickup.com/9011731879/v/l/li/901113872792
  "901113872792": {
    listId: "901113872792",
    label: "Sleep Stories",
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
