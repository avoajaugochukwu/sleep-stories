import { fal } from "@fal-ai/client";
import type { Scene } from "@/lib/types";
import { IMAGE_GENERATION_SUFFIX } from "@/lib/prompts/all-prompts";

// Grok Imagine has no negative_prompt param, so the key avoidances are folded
// into the prompt text instead.
const AVOID_CLAUSE =
  "Avoid: bright daylight, harsh or high-key lighting, text, captions, watermarks, logos, busy or cluttered compositions, and anything scary, jarring, or violent.";

interface FalImageResult {
  data?: { images: Array<{ url: string }> };
  images?: Array<{ url: string }>;
}

export interface GeneratedImage {
  image_url: string;
  prompt_used: string;
}

/**
 * Generate one dark, calming 16:9 scene image via Grok Imagine (xAI) on fal.
 * Shared by the interactive route (app/api/generate/scene-image) and the
 * background worker. Throws on failure so callers decide how to retry/skip.
 */
export async function generateSceneImage(
  scene: Pick<Scene, "scene_number" | "visual_prompt">,
): Promise<GeneratedImage> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY is not configured");
  fal.config({ credentials: apiKey });

  const basePrompt =
    scene.visual_prompt ||
    "A calm, dark, dreamlike scene in deep shadow with soft muted light";
  const styledPrompt = `${basePrompt}, ${IMAGE_GENERATION_SUFFIX}. ${AVOID_CLAUSE}`;

  const result = (await fal.subscribe("xai/grok-imagine-image", {
    input: {
      prompt: styledPrompt,
      num_images: 1,
      aspect_ratio: "16:9",
      resolution: "2k",
      output_format: "jpeg",
    },
    logs: false,
  })) as FalImageResult;

  const imageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL in response");

  return { image_url: imageUrl, prompt_used: styledPrompt };
}
