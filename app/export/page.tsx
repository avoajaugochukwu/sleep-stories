"use client";

import React from 'react';
import { ExportPanel } from '@/components/workflow/export-panel';
import { Download } from 'lucide-react';

export default function ExportPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <div className="stagger space-y-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/40 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            <Download className="h-3.5 w-3.5 text-primary" /> Step Three · The Export
          </span>
          <h1 className="mt-6 font-display text-4xl font-light tracking-tight sm:text-5xl">
            Take it <span className="text-aurora italic">into the night.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Bundle your script, scene list, and rendered images — ready for the editing room.
          </p>
        </div>

        <div className="glass-card p-6 sm:p-8">
          <ExportPanel />
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Session-only · nothing is saved · export before you leave
        </footer>
      </div>
    </div>
  );
}
