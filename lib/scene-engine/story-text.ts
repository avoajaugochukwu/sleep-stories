// ============================================================================
// STORY TEXT — AI-derived title + bottom-left captions
// ----------------------------------------------------------------------------
// Replaces the old hand-typed title and the every-6th-scene verbatim line.
// One GPT-4o pass reads the whole script and returns:
//   • a short, evocative TITLE (drives the title card AND the S3 filename), and
//   • a short calming PHRASE for each pre-selected moment (a handful of scenes
//     spread 3–5 min apart), rendered bottom-left over the video.
// Timing anchors to the scenes' already-computed startFrames (audio-stretched),
// so no transcription is needed.
// ============================================================================

import { z } from "zod";
import { openai, DEFAULT_MODEL } from "@/lib/ai/openai";
import { toGentleLine } from "@/lib/remotion/build-input";
import type { SleepRenderScene, StoryTextOverlay } from "@/lib/remotion/types";

// How far apart captions appear (random, per video) and how each one behaves.
const CAPTION_MIN_GAP_SEC = 180; // 3 min
const CAPTION_MAX_GAP_SEC = 300; // 5 min
const CAPTION_LEAD_SEC = 1.5; // delay after the scene's start
const CAPTION_FADE_SEC = 1.6;
const CAPTION_HOLD_SEC = 4.5;
const CAPTION_TOTAL_SEC = CAPTION_FADE_SEC + CAPTION_HOLD_SEC + CAPTION_FADE_SEC;

const FALLBACK_TITLE = "A Quiet Night";

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function stripCodeFences(text: string): string {
  return text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

/**
 * Pick the scenes that will carry a caption: the first one 3–5 min in, then
 * every 3–5 min after, anchored to whichever scene is live at that time. Returns
 * scenes in timeline order. Short videos may yield none (that's fine).
 */
export function selectCaptionScenes(
  scenes: SleepRenderScene[],
  fps: number,
): SleepRenderScene[] {
  const picks: SleepRenderScene[] = [];
  let nextAt = rand(CAPTION_MIN_GAP_SEC, CAPTION_MAX_GAP_SEC) * fps;
  for (const s of scenes) {
    if (s.startFrame >= nextAt) {
      picks.push(s);
      nextAt = s.startFrame + rand(CAPTION_MIN_GAP_SEC, CAPTION_MAX_GAP_SEC) * fps;
    }
  }
  return picks;
}

const StoryTextSchema = z.object({
  title: z.string(),
  captions: z.array(z.object({ id: z.string(), text: z.string() })),
});

const SYSTEM_PROMPT = `You write copy for calming, dreamy SLEEP-STORY videos — long, ambient narration meant to help viewers drift off to sleep. Everything you write must be soft, evocative and unobtrusive: never loud, listy, clickbaity, or salesy.

You are given the full narration script and a list of selected MOMENTS. Each moment has an "id" and the verbatim snippet narrated at that point in the video.

Return JSON shaped EXACTLY like:
{ "title": "<2-6 word title>", "captions": [ { "id": "<id>", "text": "<phrase>" } ] }

Rules:
- title: a short, evocative title for the whole video, 2-6 words, Title Case, no punctuation, no quotes. Capture the setting and mood (e.g. "A Quiet Night in the Old Forest"). Do not mention "sleep" or "story".
- captions: one entry for EVERY moment id, in the same order. Each "text" is a very short on-screen phrase of AT MOST 5 words, drawn faithfully from that moment — you may gently rephrase for flow but never invent details that aren't in the snippet. Lowercase except proper nouns; no trailing punctuation. It should read like a soft whispered caption, not a summary.
- Every input id must appear exactly once.`;

interface Moment {
  id: string;
  snippet: string;
}

/**
 * One LLM call → { title, captions-by-id }. Falls back gracefully (heuristic
 * title + verbatim first-clause captions) if the API errors or returns garbage,
 * so a render is never blocked on the LLM.
 */
async function callModel(
  fullScript: string,
  moments: Moment[],
): Promise<{ title: string; byId: Map<string, string> }> {
  const fallback = () => ({
    title: heuristicTitle(fullScript),
    byId: new Map(moments.map((m) => [m.id, toGentleLine(m.snippet, 40)])),
  });

  try {
    const userMessage = JSON.stringify({
      script: fullScript,
      moments: moments.map((m) => ({ id: m.id, text: m.snippet })),
    });
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_completion_tokens: 2048,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    const parsed = StoryTextSchema.parse(JSON.parse(stripCodeFences(text)));

    const title = parsed.title.trim() || heuristicTitle(fullScript);
    const byId = new Map<string, string>();
    for (const c of parsed.captions) {
      const clean = c.text.trim().replace(/[.,;:!?]+$/, "");
      if (clean) byId.set(c.id, clean);
    }
    // Backfill any id the model skipped with a verbatim fallback.
    for (const m of moments) {
      if (!byId.has(m.id)) byId.set(m.id, toGentleLine(m.snippet, 40));
    }
    return { title, byId };
  } catch (err) {
    console.error("[story-text] LLM derivation failed, using fallback:", err);
    return fallback();
  }
}

/** Cheap title from the opening words when the LLM is unavailable. */
function heuristicTitle(script: string): string {
  const first = toGentleLine(script, 36);
  if (!first) return FALLBACK_TITLE;
  return first
    .split(/\s+/)
    .slice(0, 6)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface StoryTextPlan {
  title: string;
  textOverlays: StoryTextOverlay[];
}

/**
 * End-to-end: select moments, ask the model for a title + captions, and lay the
 * captions out on the timeline. `renderScenes` carry the real startFrames;
 * `storyboard` supplies the verbatim snippet for each scene_number.
 */
export async function planStoryText(args: {
  renderScenes: SleepRenderScene[];
  storyboard: { scene_number: number; script_snippet?: string }[];
  fps: number;
  totalFrames: number;
}): Promise<StoryTextPlan> {
  const { renderScenes, storyboard, fps, totalFrames } = args;

  const snippetByNumber = new Map(
    storyboard.map((s) => [s.scene_number, (s.script_snippet ?? "").trim()]),
  );
  const fullScript = [...storyboard]
    .sort((a, b) => a.scene_number - b.scene_number)
    .map((s) => (s.script_snippet ?? "").trim())
    .filter(Boolean)
    .join(" ");

  const sceneNumberOf = (id: string) => Number(id.replace(/^scene-/, ""));

  // Selected scenes that actually have a snippet to ground the caption.
  const selected = selectCaptionScenes(renderScenes, fps).filter((s) =>
    (snippetByNumber.get(sceneNumberOf(s.id)) ?? "").length > 0,
  );

  const moments: Moment[] = selected.map((s) => ({
    id: s.id,
    snippet: snippetByNumber.get(sceneNumberOf(s.id)) ?? "",
  }));

  const { title, byId } = await callModel(fullScript, moments);

  const lead = Math.round(CAPTION_LEAD_SEC * fps);
  const fadeFrames = Math.round(CAPTION_FADE_SEC * fps);
  const total = Math.round(CAPTION_TOTAL_SEC * fps);

  const textOverlays: StoryTextOverlay[] = [];
  for (const s of selected) {
    const text = byId.get(s.id);
    if (!text) continue;
    const startFrame = s.startFrame + lead;
    const durationInFrames = Math.min(total, totalFrames - startFrame);
    if (durationInFrames <= fadeFrames) continue; // too close to the end
    textOverlays.push({ text, startFrame, durationInFrames, fadeFrames });
  }

  return { title: title || FALLBACK_TITLE, textOverlays };
}
