// ============================================================================
// STORY TITLE — one AI-derived title for the video.
// ----------------------------------------------------------------------------
// Drives the title card AND the S3 filename. One LLM pass over the whole script;
// falls back to a heuristic (first few words, Title Cased) if the API errors, so
// a render is never blocked on the model. Captions/overlays/title-card timing
// are all composited by Modal (render-modal/), not here.
// ============================================================================

import { openai, modelParams } from "@/lib/ai/openai";

const FALLBACK_TITLE = "A Quiet Night";
// A 2h script is huge; the title only needs the opening arc, so cap the prompt.
const MAX_SCRIPT_CHARS = 8000;

const SYSTEM_PROMPT = `You write titles for calming, dreamy SLEEP-STORY videos — long, ambient narration meant to help viewers drift off to sleep.

Return JSON shaped EXACTLY like: { "title": "<2-6 word title>" }

Rules for the title: 2-6 words, Title Case, no punctuation, no quotes. Capture the setting and mood (e.g. "A Quiet Night in the Old Forest"). Do not mention "sleep" or "story".`;

/** Cheap title from the opening words when the LLM is unavailable. */
function heuristicTitle(script: string): string {
  const words = script.replace(/\s+/g, " ").trim().split(" ").slice(0, 6);
  if (words.length === 0) return FALLBACK_TITLE;
  return (
    words
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
      .replace(/[.,;:!?—-]+$/, "")
      .trim() || FALLBACK_TITLE
  );
}

/**
 * Derive a short, evocative title from the storyboard's script snippets. One
 * LLM call, heuristic fallback on any error/garbage.
 */
export async function deriveStoryTitle(
  storyboard: { scene_number: number; script_snippet?: string }[],
): Promise<string> {
  const fullScript = [...storyboard]
    .sort((a, b) => a.scene_number - b.scene_number)
    .map((s) => (s.script_snippet ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (!fullScript) return FALLBACK_TITLE;

  try {
    const response = await openai.chat.completions.create({
      ...modelParams(0.6),
      max_completion_tokens: 64,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ script: fullScript.slice(0, MAX_SCRIPT_CHARS) }),
        },
      ],
    });
    const text = (response.choices[0]?.message?.content ?? "")
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const title = String(JSON.parse(text).title ?? "").trim();
    return title || heuristicTitle(fullScript);
  } catch (err) {
    console.error("[story-text] title LLM failed, using heuristic:", err);
    return heuristicTitle(fullScript);
  }
}
