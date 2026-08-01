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
    assert.deepEqual(cutScript(s, 4, 0), [s]);
  },

  'cuts after every Nth sentence'() {
    const scenes = cutScript(sentences(12), 4, 0);
    assert.equal(scenes.length, 3);
    for (const scene of scenes) {
      assert.equal((scene.match(/\./g) ?? []).length, 4, `wrong sentence count: ${scene}`);
    }
  },

  'a remainder of one sentence folds into the previous scene'() {
    const scenes = cutScript(sentences(9), 4, 0);
    assert.equal(scenes.length, 2, scenes.map((s) => s.length));
    assert.equal((scenes.at(-1).match(/\./g) ?? []).length, 5);
  },

  'a remainder of two or three sentences stands alone'() {
    assert.equal(cutScript(sentences(10), 4, 0).length, 3);
    assert.equal(cutScript(sentences(11), 4, 0).length, 3);
  },

  'snippets rejoin the script exactly'() {
    for (const n of [1, 2, 5, 9, 12, 13, 60, 61]) {
      const s = sentences(n);
      assert.equal(cutScript(s, 4, 0).join(''), s, `n=${n}`);
    }
  },

  'newlines and blank lines survive'() {
    const s = 'One.\n\nTwo.\nThree.\n\n\nFour. Five. Six.';
    assert.equal(cutScript(s, 4, 0).join(''), s);
  },

  'leading and trailing whitespace survive'() {
    const s = `  ${sentences(9)}  `;
    assert.equal(cutScript(s, 4, 0).join(''), s);
  },

  'quotes and brackets do not break sentence detection'() {
    const s = '"Stop," he said. (He did not stop.) Then the rain came. Then silence.';
    assert.equal(cutScript(s, 4, 0).join(''), s);
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
      assert.deepEqual(cutScript(s, 4, 0), [s], `split inside: ${s}`);
    }
  },

  'a repeated sentence does not confuse the cut'() {
    // The bug the old indexOf-from-zero code had. Locating forward-only from a
    // running cursor is what makes a repeated line resolve to its own position.
    const s = 'The night was still. A fox crossed. The night was still. Then dawn. And rain.';
    assert.equal(cutScript(s, 2, 0).join(''), s);
    assert.equal(cutScript(s, 2, 0).length, 2);
  },

  'a two-hour script produces a sane scene count'() {
    // ~1200 sentences. At 4 per scene that is 300 scenes of ~20-25s.
    const s = sentences(1200);
    const scenes = cutScript(s, 4, 0);
    assert.equal(scenes.join(''), s);
    assert.equal(scenes.length, 300);
  },

  // The opening ramp: 20 scenes of 2 sentences, then 5 per scene.
  'the first 20 scenes take 2 sentences, the rest take 5'() {
    const scenes = cutScript(sentences(90)); // 20*2 = 40, then 50/5 = 10 more
    assert.equal(scenes.length, 30);
    for (let i = 0; i < 20; i++) {
      assert.equal((scenes[i].match(/\./g) ?? []).length, 2, `scene ${i}`);
    }
    for (let i = 20; i < 30; i++) {
      assert.equal((scenes[i].match(/\./g) ?? []).length, 5, `scene ${i}`);
    }
  },

  'a script shorter than the ramp is all 2-sentence scenes'() {
    const scenes = cutScript(sentences(10));
    assert.equal(scenes.length, 5);
    for (const s of scenes) assert.equal((s.match(/\./g) ?? []).length, 2);
  },

  'the ramp still rejoins the script exactly'() {
    for (const n of [1, 2, 3, 5, 40, 41, 90, 137]) {
      const s = sentences(n);
      assert.equal(cutScript(s).join(''), s, `n=${n}`);
    }
  },

  'a one-sentence remainder folds back under the ramp too'() {
    // 41 sentences: 20 scenes x2 = 40, leaving a single sentence.
    const scenes = cutScript(sentences(41));
    assert.equal(scenes.length, 20);
    assert.equal((scenes.at(-1).match(/\./g) ?? []).length, 3);
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
