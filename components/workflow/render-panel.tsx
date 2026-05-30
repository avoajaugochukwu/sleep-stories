"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/store";
import type { RenderJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NavigationButtons } from "@/components/common/navigation-buttons";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  History,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

interface HistoryItem {
  renderId: string;
  name: string;
  url: string;
  key: string;
  sizeMB: number;
  createdAt: string;
}

function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${r}s`;
}

function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function RenderPanel() {
  const router = useRouter();
  const {
    audio,
    storyboardScenes,
    renders,
    addRender,
    updateRender,
    removeRender,
    _hydrated,
  } = useSessionStore();

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const withImages = storyboardScenes.filter((s) => s.image_url).length;
  const ready = !!audio && storyboardScenes.length > 0 && withImages > 0;

  // ── 7-day history from S3 ────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/renders");
      const data = await res.json();
      if (res.ok) setHistory(data.renders ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // ── Poll every active render (resumes on refresh via persisted store) ────
  const historyRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!_hydrated) return;
    const tick = async () => {
      const active = useSessionStore
        .getState()
        .renders.filter((r) => r.status === "rendering");
      if (active.length === 0) return;
      await Promise.all(
        active.map(async (r) => {
          try {
            const res = await fetch(
              `/api/render/${r.renderId}?bucket=${encodeURIComponent(r.bucketName)}`,
            );
            const p = await res.json();
            if (!res.ok) return;
            if (p.fatalErrorEncountered) {
              updateRender(r.renderId, {
                status: "error",
                error: p.errors?.[0]?.message ?? "Render failed on Lambda",
              });
              return;
            }
            if (p.done) {
              updateRender(r.renderId, {
                status: "done",
                progress: 1,
                outputFile: p.outputFile,
                cost: p.costsAccrued ?? undefined,
              });
              // A new file just landed — refresh the 7-day list shortly after.
              if (historyRefreshTimer.current)
                clearTimeout(historyRefreshTimer.current);
              historyRefreshTimer.current = setTimeout(() => void loadHistory(), 1500);
              return;
            }
            updateRender(r.renderId, {
              progress: p.overallProgress ?? 0,
              cost: p.costsAccrued ?? undefined,
            });
          } catch {
            /* transient — try again next tick */
          }
        }),
      );
    };
    const id = setInterval(tick, 2500);
    void tick();
    return () => clearInterval(id);
  }, [_hydrated, updateRender, loadHistory]);

  const activeCount = renders.filter((r) => r.status === "rendering").length;

  const handleRender = async () => {
    if (!audio) return;
    setStartError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/render/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: storyboardScenes,
          audioKey: audio.key,
          audioDurationSec: audio.durationSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start render");
      addRender({
        renderId: data.renderId,
        bucketName: data.bucketName,
        title: data.title || "Untitled",
        createdAt: Date.now(),
        status: "rendering",
        progress: 0,
      });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const deleteHistory = async (item: HistoryItem) => {
    setHistory((h) => h.filter((x) => x.key !== item.key));
    try {
      await fetch(`/api/renders?key=${encodeURIComponent(item.key)}`, {
        method: "DELETE",
      });
    } catch {
      void loadHistory();
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl mb-2">Render your sleep video</h2>
        <p className="text-muted-foreground">
          Fire off as many takes as you like — they render in parallel and stay here for 7 days.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Before we render</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row
            ok={!!audio}
            label="Narration audio"
            detail={
              audio
                ? `${audio.fileName} · ${fmtDuration(audio.durationSec)}`
                : "Upload it on the Scenes step"
            }
            icon={AudioLines}
          />
          <Row
            ok={storyboardScenes.length > 0 && withImages > 0}
            label="Scene images"
            detail={
              storyboardScenes.length > 0
                ? `${withImages} of ${storyboardScenes.length} scenes have imagery`
                : "Generate scenes first"
            }
            icon={Film}
          />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        The title card and on-screen captions are written automatically from
        your script when you render.
      </p>

      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          onClick={handleRender}
          disabled={!ready || starting}
          className="min-w-[220px]"
        >
          {starting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…
            </>
          ) : (
            <>
              <Clapperboard className="mr-2 h-4 w-4" />
              {renders.length > 0 ? "Render another take" : "Render video"}
            </>
          )}
        </Button>
        {!ready && (
          <p className="text-xs text-muted-foreground">
            Add narration audio and generated scenes to enable rendering.
          </p>
        )}
        {startError && <p className="text-xs text-destructive">{startError}</p>}
        {activeCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {activeCount} render{activeCount > 1 ? "s" : ""} in progress — you can start more.
          </p>
        )}
      </div>

      {/* This session's renders */}
      {renders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">This session</h3>
          {renders.map((r) => (
            <SessionRenderRow key={r.renderId} job={r} onRemove={removeRender} />
          ))}
        </div>
      )}

      {/* 7-day history from S3 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <History className="h-4 w-4" /> Recent renders · last 7 days
          </h3>
          <Button variant="ghost" size="sm" onClick={() => void loadHistory()}>
            <RefreshCw className={`h-3.5 w-3.5 ${historyLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {historyLoading ? "Loading…" : "No renders yet in the last 7 days."}
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
                    {fmtAgo(item.createdAt)} · {item.sizeMB} MB
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-primary hover:bg-accent"
                  >
                    <Download className="mr-1 h-3.5 w-3.5" /> MP4
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void deleteHistory(item)}
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

      <NavigationButtons
        onPrevious={() => router.push("/scenes")}
        onNext={() => router.push("/export")}
        nextLabel="Export assets"
      />
    </div>
  );
}

function SessionRenderRow({
  job,
  onRemove,
}: {
  job: RenderJob;
  onRemove: (renderId: string) => void;
}) {
  const pct = Math.round(job.progress * 100);
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{job.title}</p>
          <p className="text-xs text-muted-foreground">
            {job.status === "rendering" && `Rendering… ${pct}%`}
            {job.status === "done" && "Ready"}
            {job.status === "error" && "Failed"}
            {job.cost != null && ` · ~$${job.cost.toFixed(3)}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {job.status === "rendering" && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          {job.status === "done" && job.outputFile && (
            <a
              href={job.outputFile}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Download
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(job.renderId)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {job.status === "rendering" && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.status === "error" && (
        <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{job.error}</span>
        </div>
      )}
    </div>
  );
}

function Row({
  ok,
  label,
  detail,
  icon: Icon,
}: {
  ok: boolean;
  label: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 ${ok ? "text-success" : "text-muted-foreground"}`} />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      {ok ? (
        <CheckCircle2 className="h-5 w-5 text-success" />
      ) : (
        <span className="text-xs text-muted-foreground">Needed</span>
      )}
    </div>
  );
}
