import type { Scene } from "@/lib/types";

// Self-hosted gen on Modal (scale-to-zero, async submit->poll).
// The endpoint renders the prompt VERBATIM; STYLE_PREFIX is prepended so every
// scene renders as a digital painting regardless of what the LLM wrote.
const IMAGE_API_BASE =
  "https://avoajaugochukwu--open-source-image-gen-web.modal.run";

// Only artistic style word we apply. LLM writes subject/action; this leads.
const STYLE_PREFIX = "highly detailed digital painting, ";

// Cold starts can take ~40s; warm jobs ~10s. Poll generously, and retry so the
// first wave — which hits a cold GPU and can blow the deadline — recovers on a
// now-warm container instead of failing (saw the whole first batch of 10 time
// out that way).
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000; // modest bump from 5 min; retries cover the rest
const MAX_ATTEMPTS = 3; // per image, incl. the first try
const RETRY_BACKOFF_MS = 3000; // exponential between attempts: 3s, 6s
// ponytail: worst case per image ≈ MAX_ATTEMPTS × POLL_TIMEOUT_MS if the endpoint
// is truly down; the worker tolerates a final failure and carries the last image.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fixed quality negatives appended to every scene's period-specific negative.
// ponytail: constant, not LLM-generated — these never vary by scene.
// SFW hard ban leads: this is YouTube. No NSFW/gore ever reaches the generator,
// regardless of what the LLM wrote — the negative prompt is the last gate.
const SFW_NEGATIVE =
  "nsfw, nude, nudity, naked, sexual, sexually explicit, sex, erotic, porn, suggestive, cleavage, lingerie, fetish, gore, gory, blood, bloody, open wound, wounds, injury, mutilation, dismemberment, corpse, dead body, viscera, guts, decapitation, violence, graphic violence, disturbing, horror";
const BASE_NEGATIVE =
  `${SFW_NEGATIVE}, text, caption, watermark, logo, signature, blurry, lowres, deformed hands, extra fingers, distorted anatomy, oversaturated, grainy`;

export interface GeneratedImage {
  image_url: string;
  prompt_used: string;
}

/**
 * Generate one digital-painting 16:9 scene image via the self-hosted Modal image
 * API. Shared by the interactive route (app/api/generate/scene-image) and the
 * background worker. Throws on failure so callers decide how to retry/skip.
 */
/**
 * Drop a style phrase the LLM wrote at the front of its own prompt, so
 * STYLE_PREFIX is not applied twice.
 *
 * `sleep-scene-prompt.ts` tells the model the exact words that get prepended
 * ("highly detailed digital painting") while instructing it not to name a style
 * — which primes it to write them anyway. In the live Somme job **77 of 176
 * scenes** came back as "highly detailed digital painting, highly detailed
 * digital painting: wide view at twilight…". Two copies of the style tokens
 * dilute the rest of the prompt for no gain.
 *
 * Only strips a LEADING occurrence, and only the phrase we ourselves prepend:
 * a scene that legitimately depicts a painting keeps its words.
 */
export function stripLeadingStyle(visualPrompt: string): string {
  // Repeated on purpose: already-stored projects can carry TWO copies, so
  // stripping one would still leave a duplicate once STYLE_PREFIX goes back on.
  return visualPrompt.replace(
    /^(?:\s*(?:highly\s+detailed\s+)?digital\s+painting\s*[,:;.\-—]*\s*)+/i,
    "",
  );
}

export async function generateSceneImage(
  scene: Pick<Scene, "scene_number" | "visual_prompt" | "negative_prompt">,
): Promise<GeneratedImage> {
  const token = process.env.IMAGE_API_TOKEN;
  if (!token) throw new Error("IMAGE_API_TOKEN is not configured");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const prompt =
    STYLE_PREFIX +
    stripLeadingStyle(
      scene.visual_prompt ||
        "a lone figure gazing up at a vast starlit night sky over calm hills, cool blue moonlight, rich saturated colour",
    );
  const negativePrompt = [scene.negative_prompt, BASE_NEGATIVE]
    .filter(Boolean)
    .join(", ");

  // Retry with exponential backoff: a cold-start timeout on the first attempt
  // almost always succeeds on the next (the container is warm by then).
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await generateOnce(headers, prompt, negativePrompt);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
}

/** One submit->poll attempt. Throws on failure so the caller can retry. */
async function generateOnce(
  headers: Record<string, string>,
  prompt: string,
  negativePrompt: string,
): Promise<GeneratedImage> {
  const submit = await fetch(`${IMAGE_API_BASE}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: prompt.slice(0, 2000),
      negative_prompt: negativePrompt.slice(0, 1000),
      style: "photo", // endpoint renders prompt verbatim; style word is in the prompt
      aspect_ratio: "16:9",
      scale: 1, // 1344×768 source for the 1920×1080 render
    }),
  });
  if (!submit.ok)
    throw new Error(`generate failed: ${submit.status} ${await submit.text()}`);
  const { job_id } = (await submit.json()) as { job_id: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let res: Response;
    try {
      res = await fetch(`${IMAGE_API_BASE}/status/${job_id}`, { headers });
    } catch {
      continue; // network blip — keep polling until deadline, like a 5xx
    }
    if (!res.ok) continue; // transient; keep polling until deadline
    const status = (await res.json()) as {
      status: string;
      images?: Array<{ url: string }>;
      error?: string | null;
    };
    if (status.status === "completed") {
      const imageUrl = status.images?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL in completed response");
      return { image_url: imageUrl, prompt_used: prompt };
    }
    if (status.status === "failed" || status.status === "error")
      throw new Error(`generation failed: ${status.error || "unknown"}`);
  }
  throw new Error(`generation timed out after ${POLL_TIMEOUT_MS}ms`);
}
