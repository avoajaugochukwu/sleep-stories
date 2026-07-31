// ============================================================================
// CUT SCRIPT -> SCENE SNIPPETS
// N sentences per scene. That is the whole rule.
//
// No model: nothing downstream cares WHERE a scene starts, only that the scenes
// tile the script — one image per scene, so a cut landing mid-thought costs
// nothing measurable. Asking a model for cut points bought a tidier cut for a
// round trip per chunk and a failure mode.
//
// No word-count targeting either: sleep narration is even-paced, so a fixed
// sentence count lands close enough. If scenes start coming out visibly long or
// short, change SENTENCES_PER_SCENE — do not reintroduce a budget.
// ============================================================================

import nlp from 'compromise';

export const WORDS_PER_SECOND = 2.5; // ~150 words per minute narration

/** ~25-30s of narration at 150wpm. The one knob. */
const SENTENCES_PER_SCENE = 5;

/**
 * Offsets in `script` where a sentence ends — the only places a scene may start.
 *
 * `compromise` does the sentence detection because a regex on `[.!?]\s` splits
 * "Mr. Smith", "Dr. Reed", "the U.S. Army" and "$4.50" mid-sentence; it gets all
 * four right. But it returns sentence *strings* and normalizes some characters,
 * so its output is used only to locate boundaries, never as the text: each
 * sentence is found forward-only in the original and we keep the position.
 *
 * A sentence it mangles past recognition simply is not found, which merges two
 * scenes and costs nothing else. Returning offsets rather than strings is what
 * makes that safe — the snippet text can only ever come from the script.
 */
function sentenceEnds(script: string): number[] {
  const ends: number[] = [];
  let cursor = 0;
  for (const raw of nlp(script).sentences().out('array') as string[]) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const at = script.indexOf(sentence, cursor);
    if (at === -1) continue;
    cursor = at + sentence.length;
    ends.push(cursor);
  }
  return ends;
}

/**
 * Cut a script into scenes of `sentencesPerScene` sentences each. Concatenating
 * them in order reproduces the script exactly — asserted, not assumed, because
 * scene durations downstream are word counts and drift never self-corrects.
 */
export function cutScript(
  script: string,
  sentencesPerScene: number = SENTENCES_PER_SCENE
): string[] {
  if (!script) return [];
  const ends = sentenceEnds(script);
  if (ends.length === 0) return [script];

  // Cut after every Nth sentence, never after the last one — the final scene
  // runs to the end of the script, trailing whitespace included.
  const cuts = ends.filter((_, i) => (i + 1) % sentencesPerScene === 0 && i + 1 < ends.length);

  // A remainder of one sentence would be a two-second flash; fold it back.
  if (ends.length % sentencesPerScene === 1) cuts.pop();

  const bounds = [0, ...cuts, script.length];
  const snippets = bounds.slice(0, -1).map((lo, i) => script.slice(lo, bounds[i + 1]));

  if (snippets.join('') !== script) {
    // Unreachable unless the above is wrong: every snippet is a slice and the
    // bounds ascend. Loud, because silent drift desynchronises the images from
    // the narration for the rest of the video.
    throw new Error(
      `cutScript lost text: ${snippets.join('').length} chars from ${script.length}`,
    );
  }
  return snippets;
}
