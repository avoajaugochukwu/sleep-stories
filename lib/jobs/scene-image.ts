import type { Scene } from "@/lib/types";

// Self-hosted gen on Modal (scale-to-zero, async submit->poll).
// `style:"photo"` = photoreal cinematic; the endpoint renders the prompt VERBATIM,
// so the full cinematic direction now lives in the scene's visual_prompt (no suffix).
const IMAGE_API_BASE =
  "https://avoajaugochukwu--open-source-image-gen-web.modal.run";

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
 * Generate one photoreal cinematic 16:9 scene image via the self-hosted Modal image
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
    scene.visual_prompt ||
    "Cinematic wide shot of a lone figure gazing up at a vast starlit night sky over calm hills, cool blue moonlight, rich saturated colour, shallow depth of field";
  const negativePrompt = [scene.negative_prompt, BASE_NEGATIVE]
    .filter(Boolean)
    .join(", ");

  const submit = await fetch(`${IMAGE_API_BASE}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: prompt.slice(0, 2000),
      negative_prompt: negativePrompt.slice(0, 1000),
      style: "photo", // photoreal cinematic; endpoint renders the prompt verbatim
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
