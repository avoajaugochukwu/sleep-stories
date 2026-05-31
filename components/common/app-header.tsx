"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, RotateCcw } from 'lucide-react';
import { useSessionStore } from '@/lib/store';

const STEPS = [
  { path: '/scenes', label: 'Scenes', step: '01' },
  { path: '/render', label: 'Render', step: '02' },
];

export function AppHeader() {
  const pathname = usePathname();
  const reset = useSessionStore((s) => s.reset);

  // Hide the workflow stepper on the landing page
  const isLanding = pathname === '/';

  const handleReset = () => {
    if (confirm('Are you sure you want to start over? All current progress will be lost.')) {
      reset();
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="group flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary/70 text-primary ring-1 ring-border/60 transition-transform group-hover:scale-105">
            <Moon className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-xl tracking-tight">Sleep Stories</span>
            <span className="block text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Nocturne Studio</span>
          </span>
        </Link>

        {!isLanding && (
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1 rounded-full border border-border/60 bg-secondary/30 p-1.5">
              {STEPS.map((s) => {
                const active = pathname === s.path;
                return (
                  <Link
                    key={s.path}
                    href={s.path}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-primary/15 text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="font-mono text-xs text-primary/70">{s.step}</span>
                    {s.label}
                  </Link>
                );
              })}
            </nav>

            <button
              onClick={handleReset}
              className="flex items-center gap-2 rounded-full border border-border/60 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-border"
            >
              <RotateCcw className="h-4 w-4" />
              Start Over
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
