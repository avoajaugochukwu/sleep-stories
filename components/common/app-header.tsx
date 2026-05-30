"use client";

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Moon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const navItems = [
  { path: '/scenes', label: 'Scenes', step: '01' },
  { path: '/render', label: 'Render', step: '02' },
  { path: '/export', label: 'Export', step: '03' },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const activeIndex = navItems.findIndex((i) => pathname?.startsWith(i.path));

  return (
    <header className="sticky top-0 z-40">
      <div className="absolute inset-0 -z-10 bg-background/55 backdrop-blur-xl border-b border-border/60" />
      <div className="mx-auto max-w-6xl px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Brand */}
          <button
            onClick={() => router.push('/scenes')}
            className="group flex items-center gap-3"
          >
            <span className="orbit-glow relative grid h-10 w-10 place-items-center rounded-full bg-secondary/70 moon-glow">
              <Moon className="h-5 w-5 text-primary animate-breathe" strokeWidth={1.75} />
            </span>
            <span className="flex flex-col items-start leading-none">
              <span className="font-display text-lg font-medium tracking-tight text-aurora">
                Sleep Stories
              </span>
              <span className="mt-1 text-[11px] uppercase tracking-[0.28em] text-muted-foreground/80">
                Nocturne Studio
              </span>
            </span>
          </button>

          {/* Step navigation */}
          <nav className="orbit-border flex items-center gap-1 rounded-full border border-border/70 bg-secondary/40 p-1 backdrop-blur-sm">
            {navItems.map((item, i) => {
              const active = pathname?.startsWith(item.path);
              const done = activeIndex > i;
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={cn(
                    'group relative flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-all duration-300 sm:px-4',
                    active
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-[10px] tabular-nums transition-colors',
                      active
                        ? 'text-primary'
                        : done
                        ? 'text-accent'
                        : 'text-muted-foreground/60'
                    )}
                  >
                    {item.step}
                  </span>
                  <span className="font-medium tracking-tight">{item.label}</span>
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
