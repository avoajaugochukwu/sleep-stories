"use client";

import { RotateCcw } from "lucide-react";
import { useSessionStore } from "@/lib/store";
import { WorkflowIO } from "@/components/common/workflow-io";

/**
 * Export / Import / Start Over, sitting with the session they act on.
 *
 * These were header buttons, which put them on every page including the queue —
 * where there is no session, so Export exported nothing and Start Over was a
 * destructive no-op on the page you now land on. Rendered inside the editor's
 * session strip instead, so "this project" is unambiguous.
 */
export function SessionTools({ className = "" }: { className?: string }) {
  const reset = useSessionStore((s) => s.reset);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <WorkflowIO />
      <button
        onClick={() => {
          if (
            confirm(
              "Start over? This clears the scenes, images and audio loaded here. Jobs in the queue are not affected.",
            )
          )
            reset();
        }}
        title="Clear this editing session"
        className="flex items-center gap-1.5 rounded-full border border-destructive/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Start over
      </button>
    </div>
  );
}
