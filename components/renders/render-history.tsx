"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, History, RefreshCw, Trash2 } from "lucide-react";

// The 7-day S3 render list. Deliberately knows nothing about the session store:
// a finished MP4 outlives the project that made it, and most of them come from
// headless ingest jobs that never had a session at all. That is why this lives
// here and not inside RenderPanel — /renders shows it with no project loaded.
interface HistoryItem {
  renderId: string;
  name: string;
  url: string;
  key: string;
  downloadUrl: string;
  sizeMB: number;
  createdAt: string;
  uploaded: boolean;
  clickupUrl: string | null;
}

// Absolute date+time plus a relative hint, so "when was this made" is obvious at
// a glance — e.g. "Jul 1, 12:26 PM · 2h ago".
export function fmtWhen(iso: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  const rel =
    mins < 1
      ? "just now"
      : mins < 60
        ? `${mins}m ago`
        : mins < 1440
          ? `${Math.round(mins / 60)}h ago`
          : `${Math.round(mins / 1440)}d ago`;
  const abs = then.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${abs} · ${rel}`;
}

/** `refreshKey` — bump it to force a reload (RenderPanel does when a take lands). */
export function RenderHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/renders");
      const data = await res.json();
      if (res.ok) setHistory(data.renders ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const remove = async (item: HistoryItem) => {
    setHistory((h) => h.filter((x) => x.key !== item.key));
    try {
      await fetch(`/api/renders?key=${encodeURIComponent(item.key)}`, { method: "DELETE" });
    } catch {
      void load();
    }
  };

  const toggleUploaded = async (item: HistoryItem) => {
    const next = !item.uploaded;
    setHistory((h) => h.map((x) => (x.renderId === item.renderId ? { ...x, uploaded: next } : x)));
    try {
      await fetch("/api/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renderId: item.renderId, uploaded: next }),
      });
    } catch {
      void load();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <History className="h-4 w-4" /> Recent renders · last 7 days
        </h3>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : "No renders yet in the last 7 days."}
        </p>
      ) : (
        <div className="space-y-2">
          {history.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtWhen(item.createdAt)} · {item.sizeMB} MB
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={item.uploaded}
                    onChange={() => void toggleUploaded(item)}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                  Uploaded
                </label>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-primary hover:bg-secondary/50"
                >
                  <ExternalLink className="mr-1 h-3.5 w-3.5" /> View
                </a>
                <a
                  href={item.downloadUrl}
                  download={`${item.name}.mp4`}
                  className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-primary hover:bg-secondary/50"
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> MP4
                </a>
                {item.clickupUrl && (
                  <a
                    href={item.clickupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium text-primary hover:bg-secondary/50"
                  >
                    ClickUp ↗
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(item)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
