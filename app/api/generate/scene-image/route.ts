import { NextRequest, NextResponse } from 'next/server';
import { generateSceneImage } from '@/lib/jobs/scene-image';

export async function POST(request: NextRequest) {
  try {
    const { scene } = await request.json();

    if (!scene) {
      return NextResponse.json({ error: 'Scene data is required' }, { status: 400 });
    }

    console.log(`[Scene Image] Generating image for scene ${scene.scene_number}`);
    const { image_url, prompt_used } = await generateSceneImage(scene);
    console.log(`[Scene Image] Successfully generated image for scene ${scene.scene_number}`);

    return NextResponse.json({
      image_url,
      prompt_used,
      aspect_ratio: '16:9',
      model: 'xai/grok-imagine-image',
      style: 'sleep-dark-cinematic',
    });
  } catch (error) {
    console.error('[Scene Image] Generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate scene image', details: errorMessage },
      { status: 500 },
    );
  }
}
