import { parseWebStream } from "music-metadata";

/**
 * Read an audio file's real duration (seconds) from a URL, server-side.
 *
 * The browser reads this off an <audio> element (see audio-url-input.tsx), but
 * the worker has no DOM — so we stream the file and parse it with music-metadata.
 *
 * `{ duration: true }` is REQUIRED, not optional: our TTS output is CBR MP3 with
 * no Xing/Info duration header (codec "MPEG 2 Layer 3", 64 kbps), so the only
 * way to get duration is to scan the frames. Without this flag format.duration
 * comes back undefined and every job fails at this step. The scan streams frame
 * by frame (no full-file buffering) — a ~70 MB / 2 h file is fine.
 */
export async function getAudioDurationSec(url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Could not fetch audio (${res.status}) for duration`);
  }
  const sizeBytes = Number(res.headers.get("content-length")) || undefined;
  const { format } = await parseWebStream(
    res.body,
    { mimeType: res.headers.get("content-type") ?? undefined, size: sizeBytes },
    { duration: true },
  );

  if (format.duration && format.duration > 0) return format.duration;

  // Last-resort estimate from bitrate × byte size (less accurate, but beats
  // failing the whole render if a future file defeats the frame scan).
  if (format.bitrate && sizeBytes) {
    const est = (sizeBytes * 8) / format.bitrate;
    if (est > 0) return est;
  }
  throw new Error(
    `Audio duration could not be determined (codec=${format.codec ?? "?"}, ` +
      `bitrate=${format.bitrate ?? "?"}, size=${sizeBytes ?? "?"})`,
  );
}
