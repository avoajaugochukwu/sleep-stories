// Colours for the derived job state, shared by the queue row and the job page.
//
// The labels themselves are NOT here — those come from the server
// (`lib/jobs/render-state.ts`) so there is exactly one place that decides what a
// job's state is called. This file only decides what colour that state is.

export type RenderState =
  | "queued"
  | "generating"
  | "needs_images"
  | "needs_render"
  | "rendering"
  | "rendered"
  | "render_failed"
  | "failed"
  | "cancelled";

export interface StateStyle {
  dot: string;
  text: string;
  bar: string;
  border: string;
}

const MUTED: StateStyle = {
  dot: "bg-muted-foreground/60",
  text: "text-muted-foreground",
  bar: "bg-muted-foreground/50",
  border: "border-border/70",
};

export const STATE_STYLE: Record<RenderState, StateStyle> = {
  queued: MUTED,
  cancelled: MUTED,
  generating: {
    dot: "bg-primary animate-pulse",
    text: "text-primary",
    bar: "bg-primary",
    border: "border-primary/40",
  },
  // Rendering is a WORKING state, not a waiting-for-you state — it gets the same
  // live treatment as generating so nobody reads it as "your turn".
  rendering: {
    dot: "bg-primary animate-pulse",
    text: "text-primary",
    bar: "bg-primary",
    border: "border-primary/40",
  },
  rendered: {
    dot: "bg-success",
    text: "text-success",
    bar: "bg-success",
    border: "border-success/40",
  },
  needs_images: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    bar: "bg-amber-500",
    border: "border-amber-500/40",
  },
  // The one state where clicking Render is the right move — amber, because it
  // wants a human, unlike `rendering`.
  needs_render: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    bar: "bg-amber-500",
    border: "border-amber-500/40",
  },
  render_failed: {
    dot: "bg-destructive",
    text: "text-destructive",
    bar: "bg-destructive",
    border: "border-destructive/40",
  },
  failed: {
    dot: "bg-destructive",
    text: "text-destructive",
    bar: "bg-destructive",
    border: "border-destructive/40",
  },
};

/** Queue ordering: things needing a human first, finished things last. */
export const STATE_ORDER: RenderState[] = [
  "generating",
  "rendering",
  "queued",
  "needs_images",
  "needs_render",
  "render_failed",
  "failed",
  "rendered",
  "cancelled",
];
