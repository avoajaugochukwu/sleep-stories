// ============================================================================
// CUT SCRIPT -> SCENE SNIPPETS
// Groups sentences into ~TARGET_SECONDS scenes. Pure arithmetic on the original
// string: every snippet is a slice, so `snippets.join('') === script` holds by
// construction and the word counts sum back to the script's.
//
// There is no model here on purpose. A model was asked for cut points once, so
// scenes would start where the narration changes subject — but nothing
// downstream cares where a scene starts, only that the scenes tile the script.
// The call bought a marginally tidier cut for a round trip per chunk and a
// failure mode. Sentence boundaries are as good and cost nothing.
// ============================================================================

import nlp from 'compromise';

const WORDS_PER_SECOND = 2.5; // ~150 words per minute narration

const TARGET_SECONDS = 20;
const MAX_SECONDS = 40; // a scene this long is one unsplittable sentence
const MIN_SECONDS = 8; // shorter than this reads as a flash; merged away

const TARGET_WORDS = TARGET_SECONDS * WORDS_PER_SECOND;
const MIN_WORDS = MIN_SECONDS * WORDS_PER_SECOND;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Offsets in `script` where a sentence ends — the only places a scene may start.
 *
 * `compromise` does the sentence detection because a regex on `[.!?]\s` splits
 * "Mr. Smith", "Dr. Reed", "the U.S. Army" and "$4.50" mid-sentence; it gets all
 * four right. But it returns sentence *strings* and normalizes some characters,
 * so its output is used only to locate boundaries, never as the text: each
 * sentence is found forward-only in the original and we keep the position.
 *
 * A sentence it mangles past recognition simply is not found, which costs one
 * candidate cut point and nothing else. That is why this returns offsets rather
 * than the strings themselves — the text can then never come from the library.
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
 * Cut a script into scene-sized snippets. Concatenating them in order
 * reproduces the script exactly — that is asserted, not assumed, because the
 * scene durations downstream are word counts and drift never self-corrects.
 */
export function cutScript(script: string): string[] {
  if (!script) return [];
  const ends = sentenceEnds(script);
  if (ends.length === 0) return [script];

  // Greedy: extend the current scene sentence by sentence until it is long
  // enough, then cut. A sentence is never split, so one very long sentence
  // simply overruns MAX_SECONDS — there is nowhere to cut it that isn't
  // mid-narration, and a held shot beats a cut in the middle of a clause.
  const cuts: number[] = [];
  let sceneStart = 0;
  for (const end of ends) {
    if (countWords(script.slice(sceneStart, end)) >= TARGET_WORDS) {
      cuts.push(end);
      sceneStart = end;
    }
  }

  // Whatever trails the last cut is usually a short remainder. Absorb it rather
  // than ending the video on a two-word flash.
  const tail = script.slice(cuts.at(-1) ?? 0);
  if (cuts.length > 0 && countWords(tail) < MIN_WORDS) cuts.pop();

  const bounds = [0, ...cuts, script.length];
  const snippets = bounds.slice(0, -1).map((lo, i) => script.slice(lo, bounds[i + 1]));

  if (snippets.join('') !== script) {
    // Unreachable unless the loop above is wrong: every snippet is a slice and
    // the bounds are ascending. Loud, because silent drift desynchronises the
    // images from the narration for the rest of the video.
    throw new Error(
      `cutScript lost text: ${snippets.join('').length} chars from ${script.length}`,
    );
  }
  return snippets;
}

export const CUT_CONSTANTS = { WORDS_PER_SECOND, TARGET_SECONDS, MAX_SECONDS, MIN_SECONDS };
