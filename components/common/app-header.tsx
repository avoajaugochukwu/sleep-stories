"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, ListChecks, ArrowLeft } from 'lucide-react';
import { ReadyTasksBadge } from '@/components/jobs/ready-tasks-badge';

// No "01"/"02" any more. The numbering sold a linear wizard, and almost no video
// walks it — ingest jobs break down AND render on their own. These are two views
// of one project, not two steps you complete in order.
const EDITOR_TABS = [
  { path: '/scenes', label: 'Scenes' },
  { path: '/render', label: 'Render' },
];

export function AppHeader() {
  const pathname = usePathname();

  // Navigation only. Export / Import / Start Over used to live here, but they
  // act on the SESSION — one project's scenes, images and audio — not on the
  // app. In the header they rode along onto the queue, where there is no session
  // and they did nothing (one of them destructively). They now live in the
  // session strip on /scenes, next to the work they affect.
  const isEditor = pathname === '/scenes' || pathname === '/render';
  const isQueue = pathname === '/jobs' || pathname.startsWith('/jobs/');

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

        <div className="flex items-center gap-3">
          {/* The queue is home. On editor pages this is the way back, so it
              reads as a back-link rather than a peer tab. */}
          <Link
            href="/jobs"
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
              isQueue
                ? 'border-border bg-primary/15 text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {isQueue ? (
              <ListChecks className="h-4 w-4" />
            ) : (
              <ArrowLeft className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Jobs</span>
            <ReadyTasksBadge />
          </Link>

          {isEditor && (
            <nav className="flex items-center gap-1 rounded-full border border-border/60 bg-secondary/30 p-1.5">
              {EDITOR_TABS.map((t) => (
                <Link
                  key={t.path}
                  href={t.path}
                  className={`rounded-full px-4 py-2 text-sm transition-colors ${
                    pathname === t.path
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
