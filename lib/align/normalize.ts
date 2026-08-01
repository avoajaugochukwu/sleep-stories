// Whisper transcribes spoken numbers as compact digits and ordinals — "18",
// "1945", "122", "4th", "3,800" — while a TTS script spells them out:
// "eighteenth", "nineteen forty-five", "one hundred and twenty-two",
// "fourth", "three thousand eight hundred". For DTW alignment to match the two,
// both sides run through this normalizer, which collapses spelled-out English
// numerals into the same digit form Whisper emits. Number-dense scripts (dates,
// unit designations, casualty counts) otherwise fail to align token-for-token —
// and sleep stories are almost all history, so this is not an edge case here.
//
// Ported verbatim from remotion-test-2's lib/utils/normalize.ts, which drives
// the same Whisper service. Keep the two in step if either is corrected.

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40,
  fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
};

type Atom =
  | { t: "n"; v: number } // a number value < 1000 (unit/teen/tens/ordinal/compound)
  | { t: "s"; v: number } // a scale word: hundred/thousand/million/billion
  | { t: "and" };

// Strip leading/trailing punctuation so a word like "forty-five," classifies.
const core = (token: string): string =>
  token.replace(/^[^\w]+/, "").replace(/[^\w]+$/, "");

const classify = (word: string): Atom | null => {
  if (word in UNITS) return { t: "n", v: UNITS[word]! };
  if (word in TENS) return { t: "n", v: TENS[word]! };
  if (word in SCALES) return { t: "s", v: SCALES[word]! };
  if (word in ORDINALS) return { t: "n", v: ORDINALS[word]! };
  if (word === "and") return { t: "and" };
  // Hyphenated tens-unit compounds: "forty-five" (45), "fifty-fourth" (54),
  // "twenty-third" (23).
  if (word.includes("-")) {
    const [hi, lo] = word.split("-");
    if (hi && lo && hi in TENS) {
      if (lo in UNITS) return { t: "n", v: TENS[hi]! + UNITS[lo]! };
      if (lo in ORDINALS && ORDINALS[lo]! < 10)
        return { t: "n", v: TENS[hi]! + ORDINALS[lo]! };
    }
  }
  return null;
};

// Parse one number starting at `start`; returns [value, nextIndex].
const parseOneNumber = (atoms: Atom[], start: number): [number, number] => {
  let i = start;
  let current = (atoms[i] as { t: "n"; v: number }).v;
  i++;

  // Year-style concatenation: two bare number groups in a row with no scale
  // word between them — "nineteen forty-five" → 1945, "two forty" → 240.
  if (i < atoms.length && atoms[i]!.t === "n") {
    const g2 = (atoms[i] as { t: "n"; v: number }).v;
    return [current * 100 + g2, i + 1];
  }

  // Standard cardinal accumulation: "one hundred and twenty-two" → 122,
  // "three thousand eight hundred" → 3800.
  let total = 0;
  while (i < atoms.length) {
    const a = atoms[i]!;
    if (a.t === "and") {
      if (i + 1 < atoms.length && atoms[i + 1]!.t === "n") {
        i++;
        continue;
      }
      break;
    }
    if (a.t === "s") {
      if (a.v === 100) current = (current === 0 ? 1 : current) * 100;
      else {
        total += (current === 0 ? 1 : current) * a.v;
        current = 0;
      }
      i++;
      continue;
    }
    // a.t === "n"
    current += a.v;
    i++;
  }
  return [total + current, i];
};

const parseRun = (atoms: Atom[]): string[] => {
  const nums: string[] = [];
  let i = 0;
  while (i < atoms.length) {
    if (atoms[i]!.t === "and") {
      i++;
      continue;
    }
    if (atoms[i]!.t === "s") {
      nums.push(String((atoms[i] as { t: "s"; v: number }).v));
      i++;
      continue;
    }
    const [v, next] = parseOneNumber(atoms, i);
    nums.push(String(v));
    i = next;
  }
  return nums;
};

const endsRun = (rawToken: string): boolean => /[,.;:!?)]$/.test(rawToken);

const preprocess = (text: string): string => {
  // Drop the thousands separators Whisper emits ("3,800" → "3800") so they
  // line up with parsed spelled-out numbers.
  const lower = text.toLowerCase().replace(/(\d),(\d)/g, "$1$2");
  const tokens = lower.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const atom = classify(core(tokens[i]!));
    if (atom && atom.t !== "and") {
      // Gather a maximal run of number tokens (commas/periods end the run, so
      // "twenty-sixth, nineteen forty-four" splits into 26 and 1944).
      const run: Atom[] = [];
      let j = i;
      while (j < tokens.length) {
        const a = classify(core(tokens[j]!));
        if (a && a.t !== "and") {
          run.push(a);
          j++;
          if (endsRun(tokens[j - 1]!)) break;
          continue;
        }
        // "and" stays in the run only when it joins two numbers.
        if (a && a.t === "and") {
          const next =
            j + 1 < tokens.length ? classify(core(tokens[j + 1]!)) : null;
          if (next && next.t !== "and") {
            run.push(a);
            j++;
            continue;
          }
        }
        break;
      }
      for (const n of parseRun(run)) out.push(n);
      i = j;
    } else {
      // Strip ordinal suffixes off digits Whisper wrote that way: 4th → 4.
      const c = core(tokens[i]!);
      const ordinalDigit = c.match(/^(\d+)(st|nd|rd|th)$/i);
      out.push(ordinalDigit ? ordinalDigit[1]! : tokens[i]!);
      i++;
    }
  }

  return out.join(" ");
};

export const normalizeText = (text: string): string =>
  preprocess(text)
    .replace(/[^\w\s']/g, " ")
    .replace(/(?<!\w)'|'(?!\w)/g, "")
    .replace(/\s+/g, " ")
    .trim();
