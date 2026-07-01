"use client";

import React from 'react';
import { RenderPanel } from '@/components/workflow/render-panel';
import { Clapperboard } from 'lucide-react';

export default function RenderPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <div className="stagger space-y-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/40 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            <Clapperboard className="h-3.5 w-3.5 text-primary" /> Step Three · The Render
          </span>
          <h1 className="mt-6 font-display text-4xl font-light tracking-tight sm:text-5xl">
            Drift it into <span className="text-aurora italic">a moving night.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            We render your scenes over the narration on Modal — soft crossfades,
            slow stars, fog, light and film grain — and hand you a finished MP4.
          </p>
        </div>

        <div className="glass-card p-6 sm:p-8">
          <RenderPanel />
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Session-only · nothing is saved · download your video before you leave
        </footer>
      </div>
    </div>
  );
}
