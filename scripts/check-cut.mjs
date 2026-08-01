// Offline check for cutScript — the one piece of the scene pipeline with no
// model in it and no test framework behind it.
//
//     npm run check:cut
//
// Most cases assert the same thing: the snippets concatenate back into the
// input. That is what the scene durations depend on, and drift never
// self-corrects, so it is worth a check that runs in a second.

import assert from 'node:assert/strict';
import { cutScript } from '../lib/scene-engine/cut-script.ts';
import { scaleScenesToAudio } from '../lib/scene-engine/cut-script.ts';

const sentences = (n) =>
  Array.from({ length: n }, (_, i) => `Sentence number ${i} runs to its end.`).join(' ');

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

  'fewer sentences than a scene holds is one scene'() {
    const s = sentences(3);
    assert.deepEqual(cutScript(s, 4), [s]);
  },

  'cuts after every Nth sentence'() {
    const scenes = cutScript(sentences(12), 4);
    assert.equal(scenes.length, 3);
    for (const scene of scenes) {
      assert.equal((scene.match(/\./g) ?? []).length, 4, `wrong sentence count: ${scene}`);
    }
  },

  'a remainder of one sentence folds into the previous scene'() {
    const scenes = cutScript(sentences(9), 4);
    assert.equal(scenes.length, 2, scenes.map((s) => s.length));
    assert.equal((scenes.at(-1).match(/\./g) ?? []).length, 5);
  },

  'a remainder of two or three sentences stands alone'() {
    assert.equal(cutScript(sentences(10), 4).length, 3);
    assert.equal(cutScript(sentences(11), 4).length, 3);
  },

  'snippets rejoin the script exactly'() {
    for (const n of [1, 2, 5, 9, 12, 13, 60, 61]) {
      const s = sentences(n);
      assert.equal(cutScript(s, 4).join(''), s, `n=${n}`);
    }
  },

  'newlines and blank lines survive'() {
    const s = 'One.\n\nTwo.\nThree.\n\n\nFour. Five. Six.';
    assert.equal(cutScript(s, 4).join(''), s);
  },

  'leading and trailing whitespace survive'() {
    const s = `  ${sentences(9)}  `;
    assert.equal(cutScript(s, 4).join(''), s);
  },

  'quotes and brackets do not break sentence detection'() {
    const s = '"Stop," he said. (He did not stop.) Then the rain came. Then silence.';
    assert.equal(cutScript(s, 4).join(''), s);
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
      assert.deepEqual(cutScript(s, 4), [s], `split inside: ${s}`);
    }
  },

  'a repeated sentence does not confuse the cut'() {
    // The bug the old indexOf-from-zero code had. Locating forward-only from a
    // running cursor is what makes a repeated line resolve to its own position.
    const s = 'The night was still. A fox crossed. The night was still. Then dawn. And rain.';
    assert.equal(cutScript(s, 2).join(''), s);
    assert.equal(cutScript(s, 2).length, 2);
  },

  'a two-hour script produces a sane scene count'() {
    // ~1200 sentences. At 4 per scene that is 300 scenes of ~20-25s.
    const s = sentences(1200);
    const scenes = cutScript(s, 4);
    assert.equal(scenes.join(''), s);
    assert.equal(scenes.length, 300);
  },

  // scaleScenesToAudio — the clip clock must equal the narration clock, or the
  // video ends early and the tail of the story is never seen. This shipped: a
  // 4684s read rendered as a 3930s video before the rescale existed.
  'scaled durations sum to the audio duration'() {
    const scenes = [{ duration: 30 }, { duration: 45 }, { duration: 12 }];
    const out = scaleScenesToAudio(scenes, 4684.824);
    const sum = out.reduce((t, s) => t + s.duration, 0);
    assert.ok(Math.abs(sum - 4684.824) < 1e-6, `sum was ${sum}`);
  },
  'scaling preserves relative scene length'() {
    const out = scaleScenesToAudio([{ duration: 10 }, { duration: 20 }], 900);
    assert.ok(Math.abs(out[1].duration / out[0].duration - 2) < 1e-9);
    assert.deepEqual(out.map((s) => Math.round(s.duration)), [300, 600]);
  },
  'scaling keeps other scene fields'() {
    const out = scaleScenesToAudio([{ duration: 10, image_url: 'a.png' }], 60);
    assert.equal(out[0].image_url, 'a.png');
    assert.equal(out[0].duration, 60);
  },
  'degenerate inputs are returned untouched, never NaN'() {
    assert.deepEqual(scaleScenesToAudio([], 100), []);
    assert.deepEqual(scaleScenesToAudio([{ duration: 0 }], 100), [{ duration: 0 }]);
    assert.deepEqual(scaleScenesToAudio([{ duration: 5 }], 0), [{ duration: 5 }]);
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
console.log(`cutScript + scene timing: ${Object.keys(checks).length} checks passed`);
