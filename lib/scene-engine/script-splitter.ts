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

// Each chunk is one LLM call that returns several ~20s scenes. 40 sentences
// (~700 words) yields ~14–18 scenes per call — a good balance of scene count
// vs. number of API round-trips (smaller chunks multiply the calls and can blow
// the analyze route's time budget on a slower model).
export const DEFAULT_SENTENCES_PER_CHUNK = 40;

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
