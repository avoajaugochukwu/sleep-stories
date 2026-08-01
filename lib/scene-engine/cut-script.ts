// ============================================================================
// CUT SCRIPT -> SCENE SNIPPETS
// N sentences per scene. That is the whole rule.
//
// No model: nothing downstream cares WHERE a scene starts, only that the scenes
// tile the script — one image per scene, so a cut landing mid-thought costs
// nothing measurable. Asking a model for cut points bought a tidier cut for a
// round trip per chunk and a failure mode.
//
// No word-count targeting either, and no duration estimate at all: scene timing
// comes from Whisper word timestamps at render time (`lib/align/`). This file
// decides only WHERE the script is cut, never HOW LONG a scene is on screen.
//
// The snippets must rejoin the script exactly — `snippets.join('') === script`
// is asserted below — because the alignment maps the concatenated script onto
// the transcript and slices each scene out of that one path. A snippet that is
// not a verbatim slice silently shifts every scene after it.
// ============================================================================

import nlp from 'compromise';

/** Steady-state scene size, ~25-30s of narration. */
const SENTENCES_PER_SCENE = 5;

/** The opening runs faster: shorter scenes mean more image changes early. */
const OPENING_SCENES = 20;
const OPENING_SENTENCES = 2;

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
 * Cut a script into scenes.
 *
 * The first `openingScenes` scenes take `openingSentences` sentences each, then
 * every scene after takes `sentencesPerScene`. Short scenes up front change the
 * image more often while a viewer is still deciding to stay; once they have
 * settled the longer holds suit a sleep video. Pass `openingScenes = 0` for a
 * uniform cut.
 *
 * Concatenating the snippets in order reproduces the script exactly — asserted,
 * not assumed, because Whisper alignment maps the concatenated script onto the
 * transcript, so a snippet that is not a verbatim slice shifts every scene after
 * it and the drift never self-corrects.
 */
export function cutScript(
  script: string,
  sentencesPerScene: number = SENTENCES_PER_SCENE,
  openingScenes: number = OPENING_SCENES,
  openingSentences: number = OPENING_SENTENCES
): string[] {
  if (!script) return [];
  const ends = sentenceEnds(script);
  if (ends.length === 0) return [script];

  // Walk the sentences, taking the opening size until the ramp is spent. Never
  // cut after the last sentence — the final scene runs to the end of the
  // script, trailing whitespace included.
  const cuts: number[] = [];
  let start = 0;
  for (let scene = 0; ; scene++) {
    const take = scene < openingScenes ? openingSentences : sentencesPerScene;
    const next = start + take;
    if (next >= ends.length) break;
    cuts.push(ends[next - 1]!);
    start = next;
  }

  // A remainder of one sentence would be a two-second flash; fold it back.
  if (ends.length - start === 1) cuts.pop();

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
