"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/lib/store';
import { SceneBreakdown } from '@/components/workflow/scene-breakdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, FileText, Sparkles, Film, CheckCircle2 } from 'lucide-react';
import { countWords } from '@/lib/utils/word-count';
import { AudioUrlInput } from '@/components/workflow/audio-url-input';

export default function ScenesPage() {
  const router = useRouter();
  const { script, setScript, storyboardScenes } = useSessionStore();
  const [localScript, setLocalScript] = useState('');
  const [isScriptSet, setIsScriptSet] = useState(!!script?.content);

  const allScenesGenerated =
    storyboardScenes.length > 0 &&
    storyboardScenes.every((scene) => scene.generation_status === 'completed');

  const handleSetScript = () => {
    if (localScript.trim()) {
      setScript({
        content: localScript,
        word_count: countWords(localScript),
        generated_at: new Date(),
      });
      setIsScriptSet(true);
    }
  };

  const handleClearScript = () => {
    setLocalScript('');
    setIsScriptSet(false);
  };

  const wordCount = countWords(localScript);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <div className="stagger space-y-8">
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

        {/* Script input */}
        {!isScriptSet && (
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
              disabled={!localScript.trim()}
              className="mt-2 h-14 w-full rounded-[calc(var(--radius-lg)-6px)] text-base moon-glow"
            >
              <Sparkles className="mr-2 h-5 w-5" /> Generate scenes
            </Button>
          </div>
        )}

        {/* Scene breakdown */}
        {isScriptSet && (
          <>
            <div className="glass-card p-6 sm:p-8">
              <SceneBreakdown />
            </div>
            <div className="text-center">
              <Button
                variant="ghost"
                onClick={handleClearScript}
                className="text-muted-foreground hover:text-foreground"
              >
                <FileText className="mr-2 h-4 w-4" /> Change script
              </Button>
            </div>
          </>
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
