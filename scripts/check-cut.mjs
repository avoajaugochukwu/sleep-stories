// Offline check for cutScript — the one piece of the scene pipeline with no
// model in it and no test framework behind it.
//
//     npm run check:cut
//
// Every case asserts the same thing in the end: the snippets concatenate back
// into the input. That is what the scene durations depend on, and drift never
// self-corrects, so it is worth a check that runs in a second.

import assert from 'node:assert/strict';
import { cutScript, CUT_CONSTANTS } from '../lib/scene-engine/cut-script.ts';

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const sentence = (i) => `Sentence number ${i} carries ${'word '.repeat(20)}to its end. `;
const script = (n) => Array.from({ length: n }, (_, i) => sentence(i)).join('');

const checks = {
  'empty script yields no scenes'() {
    assert.deepEqual(cutScript(''), []);
  },

  'whitespace-only script survives as one scene'() {
    assert.deepEqual(cutScript('   '), ['   ']);
  },

  'a script with no terminator is still covered'() {
    const s = 'no full stop here';
    assert.deepEqual(cutScript(s), [s]);
  },

  'one short sentence is one scene'() {
    const s = 'A quiet room.';
    assert.deepEqual(cutScript(s), [s]);
  },

  'snippets rejoin the script exactly'() {
    const s = script(60);
    assert.equal(cutScript(s).join(''), s);
  },

  'newlines and blank lines survive'() {
    const s = 'One.\n\nTwo.\nThree.\n\n\nFour.';
    assert.equal(cutScript(s).join(''), s);
  },

  'leading and trailing whitespace survive'() {
    const s = '  A quiet room. The lamp burned low.  ';
    assert.equal(cutScript(s).join(''), s);
  },

  'quotes and brackets do not break sentence detection'() {
    const s = '"Stop," he said. (He did not stop.) Then the rain came.';
    assert.equal(cutScript(s).join(''), s);
  },

  'scenes land near the target length'() {
    const target = CUT_CONSTANTS.TARGET_SECONDS * CUT_CONSTANTS.WORDS_PER_SECOND;
    const scenes = cutScript(script(60));
    // The last scene absorbs the remainder, so check the rest.
    for (const scene of scenes.slice(0, -1)) {
      assert.ok(
        words(scene) >= target,
        `scene of ${words(scene)} words is under the ${target}-word target`,
      );
      assert.ok(
        words(scene) < target * 2,
        `scene of ${words(scene)} words overran the target badly`,
      );
    }
  },

  'a short tail is merged rather than left dangling'() {
    const min = CUT_CONSTANTS.MIN_SECONDS * CUT_CONSTANTS.WORDS_PER_SECOND;
    const s = script(20) + 'Yes.';
    const scenes = cutScript(s);
    assert.equal(scenes.join(''), s);
    assert.ok(
      words(scenes.at(-1)) >= min,
      `tail scene of ${words(scenes.at(-1))} words should have merged`,
    );
  },

  'one enormous sentence is never split mid-narration'() {
    const s = `${'word '.repeat(400)}end.`;
    assert.deepEqual(cutScript(s), [s]);
  },

  'abbreviations are not treated as sentence ends'() {
    // The reason compromise is a dependency: a regex on [.!?]\s splits every
    // one of these mid-sentence, and a cut mid-sentence is a visible glitch.
    for (const s of [
      'Mr. Smith walked home through the snow.',
      'Dr. Reed opened the heavy wooden door.',
      'The U.S. Army arrived before the frost.',
      'The lamp cost $4.50 in the village shop.',
    ]) {
      assert.deepEqual(cutScript(s), [s], `split inside: ${s}`);
    }
  },

  'a repeated phrase does not confuse the cut'() {
    // The bug the old indexOf-based code had. Slicing by offset cannot hit it,
    // which is the point of doing it this way.
    const s = 'the night was still. A fox crossed the road. the night was still. Then dawn.';
    assert.equal(cutScript(s).join(''), s);
  },

  'a realistic script produces a sane scene count'() {
    // ~2h of narration: 18000 words at 150wpm. Scenes are ~20s, so expect a few
    // hundred, not a handful and not one per sentence.
    const s = script(600);
    const scenes = cutScript(s);
    assert.equal(scenes.join(''), s);
    const totalSeconds = words(s) / CUT_CONSTANTS.WORDS_PER_SECOND;
    const expected = totalSeconds / CUT_CONSTANTS.TARGET_SECONDS;
    assert.ok(
      scenes.length > expected * 0.5 && scenes.length < expected * 1.5,
      `${scenes.length} scenes for ~${Math.round(expected)} expected`,
    );
  },
};

let failed = 0;
for (const [name, check] of Object.entries(checks)) {
  try {
    check();
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n  ${err.message}`);
  }
}
if (failed) process.exit(1);
console.log(`cutScript: ${Object.keys(checks).length} checks passed`);
