// ============================================================================
// SCRIPT SPLITTER (ported from scene-generation-service)
// Splits a script into contiguous chunks of N sentences. Every sentence lands
// in exactly one chunk — this is the foundation of the no-gap guarantee.
// ============================================================================

import nlp from 'compromise';

export interface Chunk {
  chunk_id: number;
  text: string;
  sentences: string[];
  sentence_count: number;
}

// Keep chunks small. A large chunk (e.g. 40 sentences) invites the LLM to
// over-group the whole thing into 1–2 giant scenes instead of honoring the
// ~30s (~60–90 word) target, and risks overflowing the response token budget
// (which silently collapses the chunk to a single fallback scene). ~10
// sentences ≈ 200 words yields a handful of correctly-sized scenes per chunk.
export const DEFAULT_SENTENCES_PER_CHUNK = 10;

/**
 * Light normalization: standardize line endings and collapse runaway
 * whitespace without destroying sentence boundaries. Mirrors the service's
 * intent (clean input for sentence detection) while keeping snippets readable.
 */
export function normalizeScript(script: string): string {
  return script
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitIntoChunks(
  script: string,
  sentencesPerChunk: number = DEFAULT_SENTENCES_PER_CHUNK
): Chunk[] {
  const doc = nlp(script);
  const sentences = (doc.sentences().out('array') as string[])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: Chunk[] = [];

  for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
    const chunkSentences = sentences.slice(i, i + sentencesPerChunk);
    chunks.push({
      chunk_id: chunks.length + 1,
      text: chunkSentences.join(' '),
      sentences: chunkSentences,
      sentence_count: chunkSentences.length,
    });
  }

  return chunks;
}
