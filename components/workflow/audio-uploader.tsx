"use client";

import React, { useRef, useState } from "react";
import { useSessionStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { AudioLines, CheckCircle2, Loader2, Upload, X } from "lucide-react";

function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  return `${m}m ${r}s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Read the real audio duration in the browser before uploading. Some encodes
// report Infinity until you nudge currentTime, so we handle that case.
function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    el.onloadedmetadata = () => {
      if (el.duration === Infinity || Number.isNaN(el.duration)) {
        el.onseeked = () => {
          cleanup();
          resolve(el.duration);
        };
        el.currentTime = 1e9;
        return;
      }
      cleanup();
      resolve(el.duration);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error("Could not read audio metadata"));
    };
    el.src = url;
  });
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

export function AudioUploader() {
  const { audio, setAudio } = useSessionStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "uploading">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      setStatus("reading");
      const durationSec = await readDuration(file);

      const presignRes = await fetch("/api/audio/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type }),
      });
      if (!presignRes.ok) {
        const { error: msg } = await presignRes.json().catch(() => ({}));
        throw new Error(msg || "Could not get an upload URL");
      }
      const { uploadUrl, key, contentType } = await presignRes.json();

      setStatus("uploading");
      setProgress(0);
      await putWithProgress(uploadUrl, file, contentType, setProgress);

      setAudio({
        key,
        fileName: file.name,
        durationSec,
        sizeBytes: file.size,
      });
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
    }
  };

  const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  const busy = status !== "idle";

  if (audio) {
    return (
      <div className="rounded-[calc(var(--radius-lg)-6px)] border border-success/30 bg-success/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{audio.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {formatDuration(audio.durationSec)} · {formatSize(audio.sizeBytes)} · narration ready
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
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac"
        className="hidden"
        onChange={onPick}
      />
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary/70 text-primary">
          <AudioLines className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium">Narration audio</p>
          <p className="text-xs text-muted-foreground">
            Upload the voiceover for this story — its length sets the video timing.
          </p>
        </div>

        {busy ? (
          <div className="w-full max-w-xs">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "reading" ? "Reading audio…" : `Uploading… ${progress}%`}
            </div>
            {status === "uploading" && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Choose audio file
          </Button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
