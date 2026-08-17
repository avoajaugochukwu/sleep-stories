// Scene timing, derived from the narration itself.
//
// The audio is the only clock. Whisper transcribes it with word-level
// timestamps, one global DTW maps the script onto that transcript, and each
// scene's start time is the moment its first word is actually spoken. Nothing
// estimates, predicts, or rescales video length.
//
// There is deliberately NO fallback. If alignment cannot place a scene the job
// throws and no video is produced — the same call `script_context` makes. A
// fallback here would ship a video whose images sit on the wrong sentences,
// which is exactly the failure we cannot see from the outside.

import { alignScriptToWhisper, type WhisperWord } from "./dtw.ts";

/** Public, unauthenticated Modal app: stable-ts + faster-whisper `small` on T4. */
const WHISPER_URL = (
  process.env.WHISPER_TRANSCRIBE_URL ||
  "https://avoajaugochukwu--whisper-transcribe-web.modal.run"
).replace(/\/$/, "");

/** Must match CROSSFADE_SEC in render-modal/modal_app.py. */
const CROSSFADE_SEC = 1.2;

const POLL_MS = 5000;
const POLL_TIMEOUT_MS = 25 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with a few retries on transient failures — a network throw or a 5xx from
 * the Whisper Modal container (cold start, worker restart, proxy blip). A single
 * such blip used to fail the whole job at the poll, throwing away a run whose
 * images were all done. A 4xx is a real client error and returns straight
 * through so the caller still fails fast on it.
 * ponytail: 4 tries, linear backoff; enough for a cold-start blip, bounded well
 * under the poll deadline.
 */
async function fetchResilient(url: string, init?: RequestInit, tries = 4): Promise<Response> {
  let lastErr: unknown = new Error("no attempt made");
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || res.status < 500) return res; // success, or a real 4xx
      lastErr = new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      lastErr = e; // network-level failure
    }
    if (i < tries - 1) await sleep(2000 * (i + 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Transcribe narration to word-level timestamps.
 *
 * Uses the async job endpoint, not `/v1/transcribe`: a 78-minute file is ~2-3
 * minutes of GPU plus a cold start of ~150s, and holding one HTTP request open
 * that long is what proxy timeouts are for. The service takes bytes, not a URL,
 * so the audio is pulled down and re-uploaded as multipart.
 */
export async function transcribe(audioUrl: string): Promise<WhisperWord[]> {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`audio download failed (${audioRes.status}) for ${audioUrl}`);
  }
  const contentType = audioRes.headers.get("content-type") ?? "audio/mpeg";
  const bytes = await audioRes.arrayBuffer();

  const form = new FormData();
  const name = audioUrl.split("/").pop()?.split("?")[0] || "audio.mp3";
  form.append("file", new Blob([bytes], { type: contentType }), name);

  const submit = await fetchResilient(`${WHISPER_URL}/v1/jobs`, {
    method: "POST",
    body: form,
  });
  if (!submit.ok) {
    throw new Error(
      `whisper submit failed (${submit.status}): ${(await submit.text()).slice(0, 300)}`,
    );
  }
  const { job_id: jobId } = (await submit.json()) as { job_id?: string };
  if (!jobId) throw new Error("whisper submit returned no job_id");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const res = await fetchResilient(`${WHISPER_URL}/v1/jobs/${jobId}`);
    if (!res.ok) {
      throw new Error(`whisper poll failed (${res.status}) for job ${jobId}`);
    }
    const body = (await res.json()) as {
      status?: string;
      result?: { words?: WhisperWord[] } | null;
      error?: string | null;
    };
    if (body.status === "failed") {
      throw new Error(`whisper job ${jobId} failed: ${body.error ?? "no reason given"}`);
    }
    if (body.status === "completed") {
      const words = body.result?.words ?? [];
      if (!words.length) throw new Error(`whisper job ${jobId} returned no words`);
      return words;
    }
  }
  throw new Error(`whisper job ${jobId} still running after ${POLL_TIMEOUT_MS / 60000}min`);
}

/**
 * Turn Whisper word timestamps into a per-scene duration list.
 *
 * `snippets` must be the exact slices `cutScript` produced — the alignment is
 * only as good as `snippets.join('') === script`.
 *
 * Transitions: the renderer puts each crossfade *inside* the opening
 * CROSSFADE_SEC of a clip (modal_app.py xfade at offset=0), so a clip that
 * began exactly on its first spoken word would still be dissolving while that
 * word played. Every boundary therefore moves half a crossfade earlier, which
 * lands the midpoint of the dissolve on the sentence boundary. A uniform shift
 * cancels in the differences, so only the ends move: scene 0 loses 0.6s and the
 * last scene gains it. The durations still sum to exactly `audioDurationSec`.
 */
export function sceneDurationsFromWords(
  snippets: string[],
  words: WhisperWord[],
  audioDurationSec: number,
): number[] {
  if (!snippets.length) throw new Error("alignment: no scenes");
  if (!(audioDurationSec > 0)) {
    throw new Error(`alignment: bad audio duration ${audioDurationSec}`);
  }

  const alignments = alignScriptToWhisper(snippets, words);

  const unmatched = alignments
    .map((a, i) => (a.matched ? -1 : i + 1))
    .filter((n) => n > 0);
  if (unmatched.length) {
    throw new Error(
      `alignment: ${unmatched.length}/${snippets.length} scenes matched no ` +
        `narration (scenes ${unmatched.slice(0, 10).join(", ")}` +
        `${unmatched.length > 10 ? "…" : ""}). The audio is probably stale or ` +
        `truncated against this script.`,
    );
  }

  const half = CROSSFADE_SEC / 2;
  // boundaries[i] is when clip i starts; boundaries[n] is the end of the video.
  const boundaries = alignments.map((a, i) =>
    i === 0 ? 0 : Math.max(0, words[a.whisperStartIdx!]!.start - half),
  );
  boundaries.push(audioDurationSec);

  const durations: number[] = [];
  for (let i = 0; i < snippets.length; i++) {
    const d = boundaries[i + 1]! - boundaries[i]!;
    // A clip shorter than the crossfade cannot be rendered — ffmpeg's xfade
    // needs `duration` seconds of both inputs to dissolve across.
    if (d < CROSSFADE_SEC) {
      throw new Error(
        `alignment: scene ${i + 1} is ${d.toFixed(2)}s, shorter than the ` +
          `${CROSSFADE_SEC}s crossfade. Scene boundaries are out of order or the ` +
          `transcript diverged from the script.`,
      );
    }
    durations.push(d);
  }
  return durations;
}

/** Transcribe + align in one call. Throws rather than guessing. */
export async function alignScenesToAudio(
  snippets: string[],
  audioUrl: string,
  audioDurationSec: number,
): Promise<number[]> {
  const t0 = Date.now();
  const words = await transcribe(audioUrl);
  console.log(
    `[align] ${words.length} words in ${((Date.now() - t0) / 1000).toFixed(0)}s ` +
      `(last word ends ${words[words.length - 1]?.end.toFixed(0)}s, audio ${audioDurationSec.toFixed(0)}s)`,
  );
  return sceneDurationsFromWords(snippets, words, audioDurationSec);
}
