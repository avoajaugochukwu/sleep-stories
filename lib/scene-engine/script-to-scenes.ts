// ============================================================================
// SCRIPT -> SCENES
// Cut the script into scene-sized snippets (deterministic, no model), read the
// script once for context and genre, then have the director write imagery for
// every scene. Two agent calls and some arithmetic.
//
// The snippets are verbatim slices of the script, which is what lets Whisper
// alignment place each scene on the narration at render time. See
// `agents/CLAUDE.md` and `lib/align/`. Nothing here assigns a duration — there
// is no audio yet at breakdown time, so any number would be a guess.
// ============================================================================

import { cutScript } from './cut-script';
import { runScriptContext, runSceneDirector } from '@/lib/agents/bridge';

export interface BreakdownScene {
  scene_number: number;
  script_snippet: string;
  visual_prompt: string; // cinematic image prompt
  negative_prompt?: string; // period-inaccurate things to exclude
}

export interface BreakdownResult {
  scenes: BreakdownScene[];
  genre: string;
  overlayPack: string;
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
      };
    }),
    genre: context.genre,
    overlayPack: context.overlay_pack,
  };
}
