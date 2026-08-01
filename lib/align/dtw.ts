// ONE global DTW over the whole script vs the whole Whisper transcript. Each
// scene's word span is then sliced out of that single alignment path.
//
// Why global and not per-scene: remotion-test-2 originally ran a windowed DTW
// per scene, advancing a cursor and, on a weak match, stepping it forward by an
// *estimated* word count. Every weak match drifted the cursor, so each later
// scene searched the wrong window and also failed — one bad patch of audio
// cascaded into the rest of the video. A global path has no cursor to drift and
// no per-scene threshold, so a dropped or hallucinated word in the middle costs
// exactly that word and nothing after it. Do not "optimise" this back into a
// windowed search.
//
// Ported from remotion-test-2's lib/utils/dtw-global.ts. Cost table unchanged.

import { normalizeText } from "./normalize.ts";

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface SceneAlignment {
  /** Index into the full whisperWords array, or null if nothing mapped. */
  whisperStartIdx: number | null;
  whisperEndIdx: number | null;
  /** Exact token matches in this scene / scene token count. */
  matchRatio: number;
  matched: boolean;
}

const DIAG = 0;
const UP = 1;
const LEFT = 2;

const FILLER_WORDS = new Set(["uh", "um", "hmm", "ah", "mhm"]);
const MISMATCH_COST = 10;
const DELETION_COST = 5;
const INSERTION_COST = 5;
const FILLER_INSERTION_COST = 1;

const tokenize = (text: string): string[] =>
  normalizeText(text).split(/\s+/).filter(Boolean);

export function alignScriptToWhisper(
  sceneTexts: string[],
  whisperWords: WhisperWord[],
): SceneAlignment[] {
  const sceneCount = sceneTexts.length;

  // Flat script tokens + each scene's contiguous [start,end) token range.
  const scriptTokens: string[] = [];
  const sceneRanges: Array<[number, number]> = [];
  for (let s = 0; s < sceneCount; s++) {
    const start = scriptTokens.length;
    for (const t of tokenize(sceneTexts[s]!)) scriptTokens.push(t);
    sceneRanges.push([start, scriptTokens.length]);
  }

  const whisperTokens = whisperWords.map((w) => normalizeText(w.word));
  const M = scriptTokens.length;
  const N = whisperTokens.length;

  const unmatched = (): SceneAlignment[] =>
    sceneTexts.map(() => ({
      whisperStartIdx: null,
      whisperEndIdx: null,
      matchRatio: 0,
      matched: false,
    }));

  if (M === 0 || N === 0) return unmatched();

  // ponytail: full O(M*N) Int8 traceback — ~96MB for a 10k-word sleep story,
  // which Railway holds fine. Band the matrix if scripts ever pass ~14k words.
  if (M * N > 200_000_000) {
    console.warn(`[dtw] matrix large (MxN=${M * N}), proceeding anyway`);
  }

  // Two cost rows (prev/cur) + a single Int8 traceback matrix.
  let prev = new Float64Array(N + 1);
  let cur = new Float64Array(N + 1);
  const T = new Int8Array((M + 1) * (N + 1));

  // Free start: skipping leading whisper words is free.
  for (let j = 0; j <= N; j++) prev[j] = 0;

  for (let i = 1; i <= M; i++) {
    // column 0: only reachable via deletions of script tokens.
    cur[0] = prev[0]! + DELETION_COST;
    T[i * (N + 1)] = UP;
    const si = scriptTokens[i - 1]!;
    for (let j = 1; j <= N; j++) {
      const wj = whisperTokens[j - 1]!;
      const matchCost = si === wj ? 0 : MISMATCH_COST;
      const insertionCost = FILLER_WORDS.has(wj)
        ? FILLER_INSERTION_COST
        : INSERTION_COST;

      const diag = prev[j - 1]! + matchCost;
      const up = prev[j]! + DELETION_COST;
      const left = cur[j - 1]! + insertionCost;

      if (diag <= up && diag <= left) {
        cur[j] = diag;
        T[i * (N + 1) + j] = DIAG;
      } else if (up <= left) {
        cur[j] = up;
        T[i * (N + 1) + j] = UP;
      } else {
        cur[j] = left;
        T[i * (N + 1) + j] = LEFT;
      }
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }

  // After the loop, `prev` holds cost row M. Free end: best column wins.
  let bestJ = 1;
  let bestCost = Infinity;
  for (let j = 1; j <= N; j++) {
    if (prev[j]! < bestCost) {
      bestCost = prev[j]!;
      bestJ = j;
    }
  }

  // Traceback.
  const scriptToWhisper = new Int32Array(M).fill(-1);
  let i = M;
  let j = bestJ;
  let totalExact = 0;
  while (i > 0) {
    const dir = T[i * (N + 1) + j];
    if (dir === DIAG) {
      scriptToWhisper[i - 1] = j - 1;
      if (scriptTokens[i - 1] === whisperTokens[j - 1]) totalExact++;
      i--;
      j--;
    } else if (dir === UP) {
      i--;
    } else {
      j--;
    }
  }

  // Per-scene slicing.
  let matchedScenes = 0;
  const out: SceneAlignment[] = sceneTexts.map((_, s) => {
    const [a, b] = sceneRanges[s]!;
    if (b <= a) {
      return {
        whisperStartIdx: null,
        whisperEndIdx: null,
        matchRatio: 0,
        matched: false,
      };
    }
    let firstMapped: number | null = null;
    let lastMapped: number | null = null;
    let exact = 0;
    for (let k = a; k < b; k++) {
      const w = scriptToWhisper[k]!;
      if (w >= 0) {
        if (firstMapped === null) firstMapped = w;
        lastMapped = w;
        if (scriptTokens[k] === whisperTokens[w]) exact++;
      }
    }
    const matched = firstMapped !== null && lastMapped !== null;
    if (matched) matchedScenes++;
    return {
      whisperStartIdx: firstMapped,
      whisperEndIdx: lastMapped,
      matchRatio: exact / (b - a),
      matched,
    };
  });

  const pct = Math.round((totalExact / M) * 100);
  console.log(
    `[dtw] M=${M} script tokens, N=${N} whisper words; cost=${Math.round(bestCost)} ` +
      `exact=${totalExact}/${M} (${pct}%); scenesMatched=${matchedScenes}/${sceneCount}`,
  );

  return out;
}
