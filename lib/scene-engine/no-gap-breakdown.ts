// ============================================================================
// NO-GAP SCENE BREAKDOWN (ported from scene-generation-service)
// Splits a script into contiguous chunks, has the LLM break each chunk into
// long scenes with verbatim coverage, heals/closes any coverage gaps, then
// renumbers globally. Guarantees every word of the script lands in exactly one
// scene. Outputs cinematic photoreal image prompts + per-scene period-accurate
// negatives (not footage search queries).
// ============================================================================

import { z } from 'zod';
import { openai, modelParams } from '@/lib/ai/openai';
import {
  splitIntoChunks,
  normalizeScript,
  DEFAULT_SENTENCES_PER_CHUNK,
  type Chunk,
} from './script-splitter';
import {
  buildSleepScenePersonaLayer,
  GLOBAL_CONTEXT_PROMPT,
} from './sleep-scene-prompt';

const WORDS_PER_SECOND = 2.5; // ~150 words per minute narration
const CHUNK_CONCURRENCY = 6;
const MIN_SCENE_DURATION = 5;

export interface BreakdownScene {
  scene_number: number;
  script_snippet: string;
  visual_prompt: string; // cinematic photoreal image prompt
  negative_prompt?: string; // period-inaccurate things to exclude
  duration: number; // seconds, derived from word count (~20s target)
}

const RawSceneSchema = z.object({
  script_snippet: z.string(),
  visual_context: z.string(),
  negative_prompt: z.string().optional(),
});
const LlmResponseSchema = z.object({ scenes: z.array(RawSceneSchema) });
type RawScene = z.infer<typeof RawSceneSchema>;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function stripCodeFences(text: string): string {
  return text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
}

/**
 * Heal a snippet to an exact substring of the chunk. If the LLM echoed the text
 * verbatim we keep it; otherwise we try a whitespace-insensitive match and
 * recover the precise slice from the chunk so downstream gap-closing can anchor.
 */
function healSnippet(snippet: string, chunkText: string): string {
  if (chunkText.includes(snippet)) return snippet;

  const collapsedChunk = chunkText.replace(/\s+/g, ' ');
  const collapsedSnippet = snippet.replace(/\s+/g, ' ').trim();
  const idx = collapsedChunk.indexOf(collapsedSnippet);
  if (idx === -1) return snippet; // unanchored — handled by gap closing / fallback

  // Map the collapsed-index back to a real slice by walking the original text.
  let realStart = 0;
  let seen = 0;
  for (let i = 0; i < chunkText.length && seen < idx; i++) {
    if (/\s/.test(chunkText[i])) {
      // collapse runs of whitespace to a single counted space
      if (i === 0 || !/\s/.test(chunkText[i - 1])) seen++;
    } else {
      seen++;
    }
    realStart = i + 1;
  }
  const candidate = chunkText.slice(realStart).replace(/\s+/g, ' ');
  if (candidate.startsWith(collapsedSnippet)) {
    // Find the real end by consuming collapsedSnippet.length collapsed chars
    let end = realStart;
    let consumed = 0;
    while (end < chunkText.length && consumed < collapsedSnippet.length) {
      const isWs = /\s/.test(chunkText[end]);
      if (isWs) {
        if (end === realStart || !/\s/.test(chunkText[end - 1])) consumed++;
      } else {
        consumed++;
      }
      end++;
    }
    const sliced = chunkText.slice(realStart, end);
    if (sliced.trim().length > 0) return sliced;
  }
  return snippet;
}

/**
 * Close any leading/inter-scene/trailing gaps so the scenes cover the whole
 * chunk verbatim. Ported from the service's closeCoverageGaps.
 */
function closeCoverageGaps(scenes: RawScene[], chunkText: string): void {
  if (scenes.length === 0) return;

  const pos = scenes.map((s) => {
    const start = chunkText.indexOf(s.script_snippet);
    return { start, end: start === -1 ? -1 : start + s.script_snippet.length };
  });

  // Leading gap
  if (pos[0].start > 0) {
    const gap = chunkText.substring(0, pos[0].start);
    if (gap.trim()) {
      scenes[0].script_snippet = gap + scenes[0].script_snippet;
      pos[0].start = 0;
      pos[0].end = scenes[0].script_snippet.length;
    }
  }

  // Gaps between adjacent scenes
  for (let i = 0; i < scenes.length - 1; i++) {
    if (pos[i].end === -1 || pos[i + 1].start === -1) continue;
    if (pos[i + 1].start > pos[i].end) {
      const gap = chunkText.substring(pos[i].end, pos[i + 1].start);
      if (gap.trim()) {
        scenes[i].script_snippet += gap;
        pos[i].end = pos[i + 1].start;
      }
    }
  }

  // Trailing gap
  const last = scenes.length - 1;
  if (pos[last].end !== -1 && pos[last].end < chunkText.length) {
    const gap = chunkText.substring(pos[last].end);
    if (gap.trim()) scenes[last].script_snippet += gap;
  }
}

async function generateForChunk(
  chunk: Chunk,
  globalContext: string | undefined
): Promise<RawScene[]> {
  const systemPrompt = buildSleepScenePersonaLayer(globalContext);
  const userPrompt = `Break the following script chunk into ~20s scenes. For each, write one elaborate cinematic photoreal image prompt and a period-accurate negative prompt.\n\n"""\n${chunk.text}\n"""`;

  let raw: unknown;
  try {
    const response = await openai.chat.completions.create({
      ...modelParams(0.7),
      max_completion_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const choice = response.choices[0];
    // A truncated response yields invalid JSON and silently collapses the whole
    // chunk into one fallback scene below — surface it instead of hiding it.
    if (choice?.finish_reason === 'length') {
      console.warn(
        `[no-gap-breakdown] chunk ${chunk.chunk_id} hit the token limit; scenes for this chunk may collapse. Consider smaller chunks.`
      );
    }
    const text = choice?.message?.content ?? '';
    raw = JSON.parse(stripCodeFences(text));
  } catch {
    // Fallback: whole chunk becomes a single scene so coverage is never lost.
    return [{ script_snippet: chunk.text, visual_context: '' }];
  }

  let parsed: RawScene[];
  try {
    parsed = LlmResponseSchema.parse(raw).scenes;
  } catch {
    return [{ script_snippet: chunk.text, visual_context: '' }];
  }

  if (parsed.length === 0) {
    return [{ script_snippet: chunk.text, visual_context: '' }];
  }

  for (const scene of parsed) {
    scene.script_snippet = healSnippet(scene.script_snippet, chunk.text);
  }
  closeCoverageGaps(parsed, chunk.text);

  // If nothing anchored at all, fall back to whole-chunk coverage.
  const anyAnchored = parsed.some((s) => chunk.text.includes(s.script_snippet));
  if (!anyAnchored) {
    return [
      {
        script_snippet: chunk.text,
        visual_context: parsed[0]?.visual_context ?? '',
      },
    ];
  }

  return parsed;
}

/** Run async tasks with a fixed concurrency cap, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface BreakdownResult {
  scenes: BreakdownScene[];
  totalChunks: number;
}

/**
 * Break a full script into gap-free, ~20s scenes with cinematic photoreal image
 * prompts + period-accurate negatives. Every word is covered exactly once.
 */
export async function breakdownScript(
  script: string,
  sentencesPerChunk: number = DEFAULT_SENTENCES_PER_CHUNK
): Promise<BreakdownResult> {
  const normalized = normalizeScript(script);
  const chunks = splitIntoChunks(normalized, sentencesPerChunk);

  // Global context pre-pass (best-effort).
  let globalContext: string | undefined;
  try {
    const response = await openai.chat.completions.create({
      ...modelParams(0.3),
      // gpt-5 reasoning tokens count against this; keep headroom so the summary
      // isn't starved to empty (caught by fallback, but then no global context).
      max_completion_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: GLOBAL_CONTEXT_PROMPT(normalized) }],
    });
    const text = response.choices[0]?.message?.content ?? '';
    globalContext = (JSON.parse(stripCodeFences(text)) as { summary?: string }).summary;
  } catch {
    globalContext = undefined;
  }

  const perChunk = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk) =>
    generateForChunk(chunk, globalContext)
  );

  // Flatten in chunk order and number globally.
  const scenes: BreakdownScene[] = [];
  let n = 0;
  for (const chunkScenes of perChunk) {
    for (const raw of chunkScenes) {
      n++;
      const duration = Math.max(
        MIN_SCENE_DURATION,
        Math.round(countWords(raw.script_snippet) / WORDS_PER_SECOND)
      );
      scenes.push({
        scene_number: n,
        script_snippet: raw.script_snippet,
        visual_prompt:
          raw.visual_context.trim() ||
          'Cinematic wide shot of a lone figure gazing up at a vast starlit night sky over calm hills, cool blue moonlight, rich saturated colour, shallow depth of field',
        negative_prompt: raw.negative_prompt?.trim() || undefined,
        duration,
      });
    }
  }

  return { scenes, totalChunks: chunks.length };
}
