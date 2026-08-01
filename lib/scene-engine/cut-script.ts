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

// A guess, and only ever a guess — it is applied at breakdown time, before any
// audio exists. Do not tune it to fix a length mismatch; scaleScenesToAudio below
// is what reconciles the two clocks once the real narration can be measured.
export const WORDS_PER_SECOND = 2.5; // ~150 words per minute narration

/**
 * Stretch the word-count duration split onto the measured narration clock.
 *
 * Scene durations start as `words / WORDS_PER_SECOND`, but the TTS voice does not
 * read at 2.5 w/s — measured 2.09 — and the finished video is only as long as its
 * clips, so the tail of the narration was silently cut off: a 78-minute read
 * shipped as a 65-minute video. Word counts stay the source of *relative* scene
 * length; the audio duration becomes the absolute total. Self-correcting if the
 * voice ever changes, which retuning the constant would not be.
 *
 * Checked by `npm run check:cut`.
 */
export function scaleScenesToAudio<T extends { duration?: number }>(
  scenes: T[],
  audioDurationSec: number,
): T[] {
  const total = scenes.reduce((t, s) => t + (s.duration || 0), 0);
  if (total <= 0 || !(audioDurationSec > 0)) return scenes;
  return scenes.map((s) => ({
    ...s,
    duration: ((s.duration || 0) / total) * audioDurationSec,
  }));
}

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
