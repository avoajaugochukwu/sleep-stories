"use client";

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/lib/store';
import { SceneBreakdown } from '@/components/workflow/scene-breakdown';
import { JobHydrator } from '@/components/workflow/job-hydrator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, FileText, Sparkles, Film, CheckCircle2 } from 'lucide-react';
import { countWords } from '@/lib/utils/word-count';
import { AudioUrlInput } from '@/components/workflow/audio-url-input';

export default function ScenesPage() {
  const router = useRouter();
  const { script, setScript, setScenes, setStoryboardScenes, storyboardScenes } =
    useSessionStore();
  const [localScript, setLocalScript] = useState(script?.content ?? '');

  // Seed the editor from an already-set script exactly once, after the store
  // hydrates from IndexedDB (which can land after first render). The editor is
  // always visible — adding audio never hides or gates it — so there's no
  // "Change script" step to click; just edit and (re)generate in any order.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && script?.content) {
      setLocalScript(script.content);
      seededRef.current = true;
    }
  }, [script?.content]);

  const isScriptSet = !!script?.content;
  const trimmed = localScript.trim();
  const storedContent = (script?.content ?? '').trim();
  const canGenerate = trimmed.length > 0 && trimmed !== storedContent;

  const allScenesGenerated =
    storyboardScenes.length > 0 &&
    storyboardScenes.every((scene) => scene.generation_status === 'completed');

  const handleSetScript = () => {
    if (!canGenerate) return;
    // New/changed script → drop the previous scenes + images so the breakdown
    // below re-runs from scratch (it keys off the script's generated_at).
    setScenes([]);
    setStoryboardScenes([]);
    setScript({
      content: localScript,
      word_count: countWords(localScript),
      generated_at: new Date(),
    });
  };

  const wordCount = countWords(localScript);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <div className="stagger space-y-8">
        {/* Prebaked-job banner — only renders when opened as ?job=<taskId>. */}
        <Suspense fallback={null}>
          <JobHydrator />
        </Suspense>

        {/* Header */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/40 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            <Film className="h-3.5 w-3.5 text-primary" /> Step Two · The Scenes
          </span>
          <h1 className="mt-6 font-display text-4xl font-light tracking-tight sm:text-5xl">
            Break it into <span className="text-aurora italic">dark, drifting imagery.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Every word lands in exactly one scene — no gaps — each paired with a calm, low-key
            cinematic prompt drawn from your script.
          </p>
        </div>

        {/* Narration audio — collected together with the script. Persists
            across the breakdown so it's ready at the render step. */}
        <div className="glass-card p-2">
          <div className="rounded-[calc(var(--radius-lg)-6px)] bg-background/40 p-3">
            <AudioUrlInput />
          </div>
        </div>

        {/* Script input — always available to edit, in any order with audio. */}
        <div className="glass-card p-2">
          <div className="rounded-[calc(var(--radius-lg)-6px)] bg-background/40 p-5">
            <div className="mb-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground/90">
                <FileText className="h-4 w-4 text-primary" /> Your script
              </label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {wordCount} words · ~{Math.max(1, Math.round(wordCount / 150))} min read
              </span>
            </div>
            <Textarea
              value={localScript}
              onChange={(e) => setLocalScript(e.target.value)}
              placeholder="Paste your narration-ready script here…"
              className="min-h-[300px] resize-none border-0 bg-transparent px-0 font-mono text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
            />
          </div>
          <Button
            onClick={handleSetScript}
            disabled={!canGenerate}
            className="mt-2 h-14 w-full rounded-[calc(var(--radius-lg)-6px)] text-base moon-glow"
          >
            <Sparkles className="mr-2 h-5 w-5" />
            {isScriptSet ? 'Update script & regenerate scenes' : 'Generate scenes'}
          </Button>
        </div>

        {/* Scene breakdown — appears below the editor once a script is set, and
            remounts (re-runs) whenever the script is (re)generated. */}
        {isScriptSet && (
          <div className="glass-card p-6 sm:p-8">
            <SceneBreakdown key={String(script?.generated_at)} />
          </div>
        )}

        {/* Continue */}
        {allScenesGenerated && (
          <div className="glass-card flex flex-col items-center justify-between gap-4 p-6 sm:flex-row">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="h-6 w-6" />
              </span>
              <div>
                <h3 className="font-display text-lg">Scenes complete</h3>
                <p className="text-sm text-muted-foreground">Every scene is rendered. Time to make the video.</p>
              </div>
            </div>
            <Button onClick={() => router.push('/render')} size="lg" className="moon-glow">
              Continue to render <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Session-only · nothing is saved · export before you leave
        </footer>
      </div>
    </div>
  );
}
