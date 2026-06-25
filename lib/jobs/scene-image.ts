import type { Scene } from "@/lib/types";
import { IMAGE_GENERATION_SUFFIX } from "@/lib/prompts/all-prompts";

// Self-hosted Qwen/Z-Image gen on Modal (scale-to-zero, async submit->poll).
// Has a real negative_prompt, so avoidances live there instead of the prompt.
const IMAGE_API_BASE =
  "https://avoajaugochukwu--open-source-image-gen-web.modal.run";
const NEGATIVE_PROMPT =
  "bright daylight, harsh or high-key lighting, text, captions, watermarks, logos, busy or cluttered composition, scary, jarring, violent";

// Cold starts can take ~40s; warm jobs ~10s. Poll generously.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GeneratedImage {
  image_url: string;
  prompt_used: string;
}

/**
 * Generate one dark, calming 16:9 scene image via the self-hosted Modal image
 * API. Shared by the interactive route (app/api/generate/scene-image) and the
 * background worker. Throws on failure so callers decide how to retry/skip.
 */
export async function generateSceneImage(
  scene: Pick<Scene, "scene_number" | "visual_prompt">,
): Promise<GeneratedImage> {
  const token = process.env.IMAGE_API_TOKEN;
  if (!token) throw new Error("IMAGE_API_TOKEN is not configured");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const basePrompt =
    scene.visual_prompt ||
    "A calm, dark, dreamlike scene in deep shadow with soft muted light";
  const styledPrompt = `${basePrompt}, ${IMAGE_GENERATION_SUFFIX}`;

  const submit = await fetch(`${IMAGE_API_BASE}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: styledPrompt.slice(0, 2000),
      aspect_ratio: "16:9",
      quality: "fast",
      scale: 1, // 1344×768 source for the 1920×1080 render (was 4 for the 4K trial)
      negative_prompt: NEGATIVE_PROMPT,
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
      return { image_url: imageUrl, prompt_used: styledPrompt };
    }
    if (status.status === "failed" || status.status === "error")
      throw new Error(`generation failed: ${status.error || "unknown"}`);
  }
  throw new Error(`generation timed out after ${POLL_TIMEOUT_MS}ms`);
}
