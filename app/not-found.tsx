import Link from 'next/link';
import { MoonStar } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-5">
      <div className="glass-card max-w-md p-10 text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-secondary/60 moon-glow">
          <MoonStar className="h-7 w-7 text-primary animate-breathe" strokeWidth={1.5} />
        </span>
        <h2 className="font-display text-3xl font-light tracking-tight">Lost in the dark</h2>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
          This page drifted off somewhere. Let&apos;s get you back to the studio.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 moon-glow"
        >
          Back to the studio
        </Link>
      </div>
    </div>
  );
}
