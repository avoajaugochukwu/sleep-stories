import { parseWebStream } from "music-metadata";

/**
 * Read an audio file's real duration (seconds) from a URL, server-side.
 *
 * The browser reads this off an <audio> element (see audio-url-input.tsx), but
 * the worker has no DOM — so we stream the file and parse its container/codec
 * headers with music-metadata. `duration` is needed before we can compute the
 * render's frame count.
 */
export async function getAudioDurationSec(url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Could not fetch audio (${res.status}) for duration`);
  }
  const { format } = await parseWebStream(res.body, {
    mimeType: res.headers.get("content-type") ?? undefined,
    size: Number(res.headers.get("content-length")) || undefined,
  });
  if (!format.duration || format.duration <= 0) {
    throw new Error("Audio duration could not be determined");
  }
  return format.duration;
}
