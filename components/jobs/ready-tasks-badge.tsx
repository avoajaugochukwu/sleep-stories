"use client";

import { useEffect, useState } from "react";

// Small "N ready" pill for the header Jobs link. Polls /api/jobs lightly so the
// count stays fresh; hidden when nothing is ready.
// ponytail: reuses GET /api/jobs; add a /count route only if this gets heavy.
export function ReadyTasksBadge() {
  const [ready, setReady] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/jobs", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d?.jobs) return;
          setReady((d.jobs as { status: string }[]).filter((j) => j.status === "ready").length);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!ready) return null;

  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-success/20 px-1.5 text-[11px] font-semibold text-success">
      {ready}
    </span>
  );
}
