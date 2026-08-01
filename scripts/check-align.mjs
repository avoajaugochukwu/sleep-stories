// Offline check for Whisper scene alignment — no network, no GPU, no key.
//
//     npm run check:align
//
// The two properties that matter:
//   1. durations tile the audio exactly (a short total truncates the story)
//   2. a bad patch of transcript costs that patch and nothing after it
// (2) is the reason this is a global DTW. The windowed version it replaces
// drifted a cursor on every weak match and cascaded into the rest of the video.

import assert from 'node:assert/strict';
import { alignScriptToWhisper } from '../lib/align/dtw.ts';
import { sceneDurationsFromWords } from '../lib/align/index.ts';
import { normalizeText } from '../lib/align/normalize.ts';

const CF = 1.2; // must match CROSSFADE_SEC

/** One whisper word per second: word i spans [i, i+0.9]. */
const wordsFrom = (text, { insertAt, insertWord, dropAt } = {}) => {
  let toks = text.split(/\s+/).filter(Boolean);
  if (dropAt !== undefined) toks = toks.filter((_, i) => i !== dropAt);
  if (insertAt !== undefined) toks.splice(insertAt, 0, insertWord);
  return toks.map((word, i) => ({ word, start: i, end: i + 0.9 }));
};

const SCENES = [
  'The night was still and cold. ',
  'A fox crossed the frozen field. ',
  'Rain came before the dawn broke.',
];
const SCRIPT = SCENES.join('');

const checks = {
  'clean transcript: every scene matches'() {
    const out = alignScriptToWhisper(SCENES, wordsFrom(SCRIPT));
    assert.equal(out.filter((a) => a.matched).length, 3);
    for (const a of out) assert.equal(a.matchRatio, 1, JSON.stringify(a));
  },

  'durations tile the audio exactly'() {
    const total = 40;
    const d = sceneDurationsFromWords(SCENES, wordsFrom(SCRIPT), total);
    assert.equal(d.length, 3);
    const sum = d.reduce((t, x) => t + x, 0);
    assert.ok(Math.abs(sum - total) < 1e-9, `sum was ${sum}`);
  },

  'boundaries sit half a crossfade before the first spoken word'() {
    // scene 1 starts at word index 6 ("A"), scene 2 at index 12 ("Rain").
    const d = sceneDurationsFromWords(SCENES, wordsFrom(SCRIPT), 40);
    assert.ok(Math.abs(d[0] - (6 - CF / 2)) < 1e-9, `scene0 ${d[0]}`);
    assert.ok(Math.abs(d[1] - 6) < 1e-9, `scene1 ${d[1]}`);
    // last scene absorbs the shift and runs to the end of the audio
    assert.ok(Math.abs(d[2] - (40 - (12 - CF / 2))) < 1e-9, `scene2 ${d[2]}`);
  },

  'a dropped word does not cascade into later scenes'() {
    // whisper misses "frozen" in scene 1
    const out = alignScriptToWhisper(SCENES, wordsFrom(SCRIPT, { dropAt: 9 }));
    assert.equal(out.filter((a) => a.matched).length, 3);
    assert.equal(out[2].matchRatio, 1, 'scene after the damage must stay clean');
  },

  'an inserted filler does not cascade into later scenes'() {
    const out = alignScriptToWhisper(
      SCENES,
      wordsFrom(SCRIPT, { insertAt: 9, insertWord: 'um' }),
    );
    assert.equal(out.filter((a) => a.matched).length, 3);
    assert.equal(out[2].matchRatio, 1);
  },

  'a misheard word keeps its position'() {
    const out = alignScriptToWhisper(
      SCENES,
      wordsFrom(SCRIPT.replace('fox', 'box')),
    );
    assert.equal(out.filter((a) => a.matched).length, 3);
    assert.equal(out[2].matchRatio, 1);
  },

  'spelled-out numbers match the digits whisper emits'() {
    // The whole reason normalize.ts exists — sleep stories are history.
    assert.equal(normalizeText('nineteen forty-five'), '1945');
    assert.equal(normalizeText('one hundred and twenty-two'), '122');
    assert.equal(normalizeText('three thousand eight hundred'), '3800');
    assert.equal(normalizeText('4th'), '4');
    assert.equal(normalizeText('3,800'), '3800');
  },

  'a date-heavy scene aligns against digit transcription'() {
    const scenes = ['On the eighteenth of June, nineteen forty-five. '];
    const whisper = wordsFrom('On the 18th of June, 1945.');
    const out = alignScriptToWhisper(scenes, whisper);
    assert.ok(out[0].matched);
    assert.equal(out[0].matchRatio, 1, `ratio ${out[0].matchRatio}`);
  },

  'an empty transcript throws rather than guessing'() {
    assert.throws(
      () => sceneDurationsFromWords(SCENES, [], 40),
      /matched no narration/,
    );
  },

  'a scene squeezed below the crossfade throws'() {
    // Two scenes whose spoken words are 0.5s apart cannot hold a 1.2s dissolve.
    const scenes = ['alpha ', 'bravo'];
    const words = [
      { word: 'alpha', start: 0, end: 0.4 },
      { word: 'bravo', start: 0.5, end: 0.9 },
    ];
    assert.throws(
      () => sceneDurationsFromWords(scenes, words, 10),
      /shorter than the 1.2s crossfade/,
    );
  },

  'bad audio duration throws'() {
    assert.throws(() => sceneDurationsFromWords(SCENES, wordsFrom(SCRIPT), 0), /bad audio duration/);
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
console.log(`whisper alignment: ${Object.keys(checks).length} checks passed`);
