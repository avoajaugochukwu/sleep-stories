import type { Scene } from "@/lib/types";

// Self-hosted gen on Modal (scale-to-zero, async submit->poll).
// The endpoint renders the prompt VERBATIM; STYLE_PREFIX is prepended so every
// scene renders as a digital painting regardless of what the LLM wrote.
const IMAGE_API_BASE =
  "https://avoajaugochukwu--open-source-image-gen-web.modal.run";

// Only artistic style word we apply. LLM writes subject/action; this leads.
const STYLE_PREFIX = "highly detailed digital painting, ";

// Cold starts can take ~40s; warm jobs ~10s. Poll generously.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fixed quality negatives appended to every scene's period-specific negative.
// ponytail: constant, not LLM-generated — these never vary by scene.
const BASE_NEGATIVE =
  "text, caption, watermark, logo, signature, blurry, lowres, deformed hands, extra fingers, distorted anatomy, oversaturated, grainy";

export interface GeneratedImage {
  image_url: string;
  prompt_used: string;
}

/**
 * Generate one digital-painting 16:9 scene image via the self-hosted Modal image
 * API. Shared by the interactive route (app/api/generate/scene-image) and the
 * background worker. Throws on failure so callers decide how to retry/skip.
 */
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
    (scene.visual_prompt ||
      "a lone figure gazing up at a vast starlit night sky over calm hills, cool blue moonlight, rich saturated colour");
  const negativePrompt = [scene.negative_prompt, BASE_NEGATIVE]
    .filter(Boolean)
    .join(", ");

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
    const res = await fetch(`${IMAGE_API_BASE}/status/${job_id}`, { headers });
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
