"use client";

import React, { useState } from "react";
import { useSessionStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { AudioLines, CheckCircle2, Loader2, Link2, X } from "lucide-react";

function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  return `${m}m ${r}s`;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Read the real audio duration in the browser straight from the URL — the file
// stays in S3, nothing is uploaded. Some encodes report Infinity until you
// nudge currentTime, so we handle that case the same way the old uploader did.
function readDurationFromUrl(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.crossOrigin = "anonymous";
    el.onloadedmetadata = () => {
      if (el.duration === Infinity || Number.isNaN(el.duration)) {
        el.onseeked = () => resolve(el.duration);
        el.currentTime = 1e9;
        return;
      }
      resolve(el.duration);
    };
    el.onerror = () =>
      reject(
        new Error(
          "Could not load audio from that URL — check the link is public/presigned and reachable.",
        ),
      );
    el.src = url;
  });
}

// Shortened display for a long S3 URL (keep the filename, drop query strings).
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return decodeURIComponent(file);
  } catch {
    return url;
  }
}

export function AudioUrlInput() {
  const { audio, setAudio } = useSessionStore();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = async () => {
    const trimmed = url.trim();
    setError(null);
    if (!isHttpUrl(trimmed)) {
      setError("Enter a valid http(s) URL to your audio in S3.");
      return;
    }
    setBusy(true);
    try {
      const durationSec = await readDurationFromUrl(trimmed);
      setAudio({ url: trimmed, durationSec });
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (audio) {
    return (
      <div className="rounded-[calc(var(--radius-lg)-6px)] border border-success/30 bg-success/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{prettyUrl(audio.url)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDuration(audio.durationSec)} · narration ready
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAudio(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="mr-1 h-4 w-4" /> Replace
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[calc(var(--radius-lg)-6px)] border border-dashed border-border/70 bg-background/40 p-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary/70 text-primary">
          <AudioLines className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium">Narration audio</p>
          <p className="text-xs text-muted-foreground">
            Paste the S3 URL of the voiceover — its length sets the video timing.
            The file stays in your bucket; nothing is uploaded.
          </p>
        </div>

        <div className="flex w-full max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleLoad();
              }}
              placeholder="https://your-bucket.s3.amazonaws.com/audio/narration.mp3"
              disabled={busy}
              className="w-full rounded-md border border-border/70 bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>
          <Button onClick={() => void handleLoad()} disabled={busy || !url.trim()}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </>
            ) : (
              "Load audio"
            )}
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
