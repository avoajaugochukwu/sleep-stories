// ============================================================================
// SCRIPT ANALYSIS API ROUTE (NO-GAP BREAKDOWN)
// Breaks a script into long (~30s), calming, photographic sleep scenes using
// the ported no-gap chunked algorithm. Every word of the script is covered
// exactly once — no scene is missed.
// ============================================================================

import { NextRequest } from 'next/server';
import { breakdownScript } from '@/lib/scene-engine/no-gap-breakdown';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { script } = await request.json();

  if (!script || typeof script !== 'string' || script.trim().length < 50) {
    return new Response(
      JSON.stringify({ error: 'Script is required (minimum 50 characters).' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        const { scenes, totalChunks } = await breakdownScript(script);

        console.log(
          `[Script Analysis] ${totalChunks} chunks -> ${scenes.length} no-gap scenes`
        );

        // Map to the scene shape the frontend already consumes.
        const mapped = scenes.map((s) => ({
          scene_number: s.scene_number,
          script_snippet: s.script_snippet,
          visual_prompt: s.visual_prompt,
          duration: s.duration,
          narration: '',
        }));

        send({ type: 'progress', text: JSON.stringify({ scenes: mapped }) });
        send({ type: 'complete', scenes: mapped });
      } catch (error) {
        console.error('[Script Analysis] Error:', error);
        send({
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to analyze script',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
