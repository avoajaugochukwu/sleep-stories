"use client";

import React, { useRef, useState } from "react";
import { useSessionStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  AudioLines,
  CheckCircle2,
  Loader2,
  Link2,
  Upload,
  X,
} from "lucide-react";

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
// No crossOrigin: we only read `duration`, which doesn't need CORS, and setting
// it would make buckets without an Access-Control-Allow-Origin header fail.
function readDurationFromUrl(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
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

// Read duration from a local File without any network: point an <audio> at a
// short-lived object URL, then revoke it. Reuses the same Infinity-nudge logic.
function readDurationFromFile(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  return readDurationFromUrl(objectUrl).finally(() =>
    URL.revokeObjectURL(objectUrl),
  );
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload a local mp3 straight to S3 (presigned PUT) and use it as the
  // narration — for quick test renders, no manual S3 upload + URL paste needed.
  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("audio/") && !/\.mp3$/i.test(file.name)) {
      setError("Pick an audio file (mp3).");
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type || "audio/mpeg";
      // 1. Ask the server for a presigned PUT target in our audio/ prefix.
      const res = await fetch("/api/audio/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not get an upload URL");
      // 2. Upload the bytes directly to S3 (never through this app's server).
      const put = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload to S3 failed (${put.status})`);
      // 3. Read the duration locally and set it as the narration.
      const durationSec = await readDurationFromFile(file);
      setAudio({ url: data.publicUrl, durationSec });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

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
            Upload an mp3 (great for quick tests) or paste the S3 URL of the
            voiceover — its length sets the video timing.
          </p>
        </div>

        {/* Upload a local mp3 — goes straight to S3, no manual upload needed. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = ""; // allow re-picking the same file
          }}
        />
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || busy}
          className="w-full max-w-md"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Upload mp3
            </>
          )}
        </Button>

        <div className="flex w-full max-w-md items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border/70" />
          or paste a URL
          <span className="h-px flex-1 bg-border/70" />
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
              disabled={busy || uploading}
              className="w-full rounded-md border border-border/70 bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>
          <Button
            onClick={() => void handleLoad()}
            disabled={busy || uploading || !url.trim()}
          >
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
