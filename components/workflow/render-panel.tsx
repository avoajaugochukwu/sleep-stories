"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SOUND_EFFECTS, type SoundEffectKey } from "@/lib/remotion/sound-effects";
import { NavigationButtons } from "@/components/common/navigation-buttons";
import { SessionTools } from "@/components/workflow/session-tools";
import { RenderHistory, fmtWhen } from "@/components/renders/render-history";
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  Loader2,
} from "lucide-react";

function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${r}s`;
}

export function RenderPanel() {
  const router = useRouter();
  const {
    audio,
    storyboardScenes,
    renders,
    addRender,
    updateRender,
    _hydrated,
  } = useSessionStore();

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Which looping ambient bed plays under the narration. Fire by default; "none"
  // keeps quick test renders light.
  const [ambience, setAmbience] = useState<SoundEffectKey | "none">("fire");
  // Bumped when a take lands, so the shared 7-day list reloads itself.
  const [historyKey, setHistoryKey] = useState(0);

  const withImages = storyboardScenes.filter((s) => s.image_url).length;
  const ready = !!audio && storyboardScenes.length > 0 && withImages > 0;

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
                finishedAt: Date.now(),
                error: p.errors?.[0]?.message ?? "Render failed on Modal",
              });
              return;
            }
            if (p.done) {
              updateRender(r.renderId, {
                status: "done",
                finishedAt: Date.now(),
                progress: 1,
                outputFile: p.outputFile,
                cost: p.costsAccrued ?? undefined,
              });
              // A new file just landed — refresh the 7-day list shortly after.
              if (historyRefreshTimer.current)
                clearTimeout(historyRefreshTimer.current);
              historyRefreshTimer.current = setTimeout(
                () => setHistoryKey((k) => k + 1),
                1500,
              );
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
  }, [_hydrated, updateRender]);

  const activeCount = renders.filter((r) => r.status === "rendering").length;

  // The headless worker starts a render itself and checkpoints it into the job's
  // projectJson, so a hydrated job arrives here with `renders` already populated.
  // Nothing displayed that: the S3 history is empty until the MP4 lands, so the
  // page looked un-rendered and one click paid Modal for a second copy of a
  // multi-hour video. Surface it, and make a second take deliberate.
  const latest = renders[0] ?? null;
  const alreadyRendered = !!latest && latest.status !== "error";
  const [confirmExtra, setConfirmExtra] = useState(false);

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
          audioUrl: audio.url,
          audioDurationSec: audio.durationSec,
          soundEffect: ambience,
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
      setConfirmExtra(false);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
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

      {/* Session tools live with the session now, not in the header. /scenes has
          them in its identity strip; this page needs its own so Export stays
          reachable from the step you are actually on. */}
      <div className="flex justify-end">
        <SessionTools />
      </div>

      {/* This project already has a render — the single most expensive thing to
          get wrong on this page, so it goes above everything else. */}
      {renders.length > 0 && (
        <div className="space-y-2">
          {renders.map((r) => (
            <div
              key={r.renderId}
              className={`glass-card flex items-center gap-3 p-4 text-sm ${
                r.status === "error"
                  ? "border-destructive/40"
                  : r.status === "done"
                    ? "border-success/40"
                    : "border-primary/40"
              }`}
            >
              {r.status === "rendering" ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              ) : r.status === "done" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              ) : (
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {r.status === "rendering"
                    ? `Already rendering — ${Math.round((r.progress ?? 0) * 100)}%`
                    : r.status === "done"
                      ? "Already rendered — video is ready"
                      : `Render failed — ${r.error ?? "unknown error"}`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.title} · started {fmtWhen(new Date(r.createdAt).toISOString())}
                  {r.cost != null ? ` · $${r.cost.toFixed(2)}` : ""}
                </p>
              </div>
              {r.status === "done" && r.outputFile && (
                <a
                  href={r.outputFile}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-xs font-medium text-primary hover:bg-accent"
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> MP4
                </a>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Jobs from the Baserow/ClickUp pipeline render automatically — you
            don&rsquo;t need to start one. Only render again if this take is wrong.
          </p>
        </div>
      )}

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
                ? `Linked · ${fmtDuration(audio.durationSec)}`
                : "Add its S3 URL on the Scenes step"
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
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-sm font-medium">Ambient sound</p>
            <p className="text-xs text-muted-foreground">
              Loops a soft bed under the narration (kept low so it never
              overpowers the voice). Pick &ldquo;Off&rdquo; for quick test renders.
            </p>
            <RadioGroup
              value={ambience}
              onValueChange={(v) => setAmbience(v as SoundEffectKey | "none")}
              className="pt-1"
            >
              {(Object.keys(SOUND_EFFECTS) as SoundEffectKey[]).map((key) => (
                <label
                  key={key}
                  htmlFor={`amb-${key}`}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <RadioGroupItem id={`amb-${key}`} value={key} />
                  {SOUND_EFFECTS[key].label}
                </label>
              ))}
              <label
                htmlFor="amb-none"
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <RadioGroupItem id="amb-none" value="none" />
                Off
              </label>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        The title card and on-screen captions are written automatically from
        your script when you render.
      </p>

      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          variant={alreadyRendered && !confirmExtra ? "outline" : "default"}
          onClick={
            alreadyRendered && !confirmExtra
              ? () => setConfirmExtra(true)
              : handleRender
          }
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
              {!alreadyRendered
                ? renders.length > 0
                  ? "Render another take"
                  : "Render video"
                : confirmExtra
                  ? "Yes — pay for another render"
                  : "Render another take…"}
            </>
          )}
        </Button>
        {alreadyRendered && confirmExtra && !starting && (
          <p className="max-w-sm text-center text-xs text-amber-500">
            This starts a second Modal render and is billed separately. These
            videos are long — confirm only if the existing take is unusable.{" "}
            <button
              type="button"
              onClick={() => setConfirmExtra(false)}
              className="underline underline-offset-2"
            >
              Cancel
            </button>
          </p>
        )}
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

      {/* Same list as /renders, one implementation. `historyKey` bumps when a
          take finishes so the new MP4 shows up without a manual refresh. */}
      <RenderHistory refreshKey={historyKey} />

      <NavigationButtons
        onPrevious={() => router.push("/scenes")}
        showNext={false}
        showReset={false}
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
