"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NavigationButtons } from "@/components/common/navigation-buttons";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  Loader2,
} from "lucide-react";

type RenderState =
  | { phase: "idle" }
  | { phase: "starting" }
  | {
      phase: "rendering";
      renderId: string;
      bucket: string;
      progress: number;
      cost: number | null;
    }
  | { phase: "done"; outputFile: string; cost: number | null }
  | { phase: "error"; message: string };

function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${r}s`;
}

export function RenderPanel() {
  const router = useRouter();
  const { audio, storyboardScenes } = useSessionStore();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<RenderState>({ phase: "idle" });
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const withImages = storyboardScenes.filter((s) => s.image_url).length;
  const ready = !!audio && storyboardScenes.length > 0 && withImages > 0;

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => () => stopPolling(), []);

  const poll = useCallback((renderId: string, bucket: string) => {
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/render/${renderId}?bucket=${encodeURIComponent(bucket)}`,
        );
        const p = await res.json();
        if (!res.ok) throw new Error(p.error || "Progress check failed");
        if (p.fatalErrorEncountered) {
          const msg = p.errors?.[0]?.message ?? "Render failed on Lambda";
          setState({ phase: "error", message: msg });
          return;
        }
        if (p.done) {
          setState({
            phase: "done",
            outputFile: p.outputFile,
            cost: p.costsAccrued ?? null,
          });
          return;
        }
        setState({
          phase: "rendering",
          renderId,
          bucket,
          progress: p.overallProgress ?? 0,
          cost: p.costsAccrued ?? null,
        });
        pollRef.current = setTimeout(tick, 2500);
      } catch (e) {
        // Transient errors shouldn't kill the whole render view — keep polling.
        pollRef.current = setTimeout(tick, 3500);
        console.warn("poll error", e);
      }
    };
    void tick();
  }, []);

  const handleRender = async () => {
    if (!audio) return;
    setState({ phase: "starting" });
    try {
      const res = await fetch("/api/render/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: storyboardScenes,
          audioKey: audio.key,
          audioDurationSec: audio.durationSec,
          title,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start render");
      setState({
        phase: "rendering",
        renderId: data.renderId,
        bucket: data.bucketName,
        progress: 0,
        cost: null,
      });
      poll(data.renderId, data.bucketName);
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const pct =
    state.phase === "rendering" ? Math.round(state.progress * 100) : 0;
  const rendering = state.phase === "starting" || state.phase === "rendering";

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl mb-2">Render your sleep video</h2>
        <p className="text-muted-foreground">
          Your scenes drift over the narration with gentle stars, fog, light and grain.
        </p>
      </div>

      {/* Readiness checklist */}
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

      <div className="space-y-2">
        <Label htmlFor="story-title">Title card (optional)</Label>
        <Input
          id="story-title"
          placeholder="e.g. A Quiet Night in the Old Forest"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={rendering}
        />
        <p className="text-xs text-muted-foreground">
          Shown as a soft fade-in at the very start. Leave blank for pure imagery.
        </p>
      </div>

      {/* Progress / result */}
      {state.phase === "rendering" || state.phase === "starting" ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {state.phase === "starting"
                  ? "Spinning up Lambda…"
                  : `Rendering on AWS Lambda… ${pct}%`}
              </span>
              {state.phase === "rendering" && state.cost != null && (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  ~${state.cost.toFixed(3)}
                </span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${state.phase === "rendering" ? pct : 4}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Long narrations render in many parallel chunks — feel free to keep this tab open.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {state.phase === "done" && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <div>
              <p className="font-medium">Your video is ready</p>
              {state.cost != null && (
                <p className="text-xs text-muted-foreground">
                  Rendered for ~${state.cost.toFixed(3)}
                </p>
              )}
            </div>
            <a
              href={state.outputFile}
              target="_blank"
              rel="noreferrer"
              className="moon-glow inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              <Download className="mr-2 h-4 w-4" /> Download MP4
            </a>
          </CardContent>
        </Card>
      )}

      {state.phase === "error" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Render failed</p>
              <p className="text-xs text-muted-foreground break-words">{state.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          onClick={handleRender}
          disabled={!ready || rendering}
          className="min-w-[220px]"
        >
          {rendering ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering…
            </>
          ) : (
            <>
              <Clapperboard className="mr-2 h-4 w-4" />
              {state.phase === "done" ? "Render again" : "Render video"}
            </>
          )}
        </Button>
        {!ready && (
          <p className="text-xs text-muted-foreground">
            Add narration audio and generated scenes to enable rendering.
          </p>
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
        <Icon
          className={`h-5 w-5 ${ok ? "text-success" : "text-muted-foreground/50"}`}
        />
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
