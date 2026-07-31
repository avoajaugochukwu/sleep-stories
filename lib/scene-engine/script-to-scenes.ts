// ============================================================================
// SCRIPT -> SCENES
// Cut the script into scene-sized snippets (deterministic, no model), read the
// script once for context and genre, then have the director write imagery for
// every scene. Two agent calls and some arithmetic.
//
// The snippets are slices of the script, so they concatenate back into it and
// the scene durations below track the narration clock. See `agents/CLAUDE.md`.
// ============================================================================

import { cutScript, CUT_CONSTANTS } from './cut-script';
import { runScriptContext, runSceneDirector } from '@/lib/agents/bridge';

const MIN_SCENE_DURATION = 5;

export interface BreakdownScene {
  scene_number: number;
  script_snippet: string;
  visual_prompt: string; // cinematic image prompt
  negative_prompt?: string; // period-inaccurate things to exclude
  duration: number; // seconds, derived from word count
}

export interface BreakdownResult {
  scenes: BreakdownScene[];
  genre: string;
  overlayPack: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Break a full script into gap-free scenes with image prompts + period-accurate
 * negatives. Also returns the inferred genre and its overlay pack, which the
 * render needs.
 */
export async function breakdownScript(script: string): Promise<BreakdownResult> {
  const snippets = cutScript(script);

  // Genre is inferred here, not configured. The pack is derived from it inside
  // the agent (agents/shared/genres.py), so there is no genre branch in lib/.
  const context = await runScriptContext(script);
  const directed = await runSceneDirector(
    snippets.map((snippet, i) => ({ id: i + 1, snippet })),
    context,
    context.genre
  );

  // The director fills any scene it could not write from its neighbour, so a
  // short answer here means the contract broke, not that a scene needs no image.
  const byId = new Map(directed.map((d) => [d.id, d]));

  return {
    scenes: snippets.map((snippet, i) => {
      const d = byId.get(i + 1);
      if (!d) {
        throw new Error(`[agents] scene_director FAILED — scene ${i + 1} came back with no prompt`);
      }
      return {
        scene_number: i + 1,
        script_snippet: snippet,
        visual_prompt: d.visual_context,
        negative_prompt: d.negative_prompt?.trim() || undefined,
        duration: Math.max(
          MIN_SCENE_DURATION,
          Math.round(countWords(snippet) / CUT_CONSTANTS.WORDS_PER_SECOND)
        ),
      };
    }),
    genre: context.genre,
    overlayPack: context.overlay_pack,
  };
}
