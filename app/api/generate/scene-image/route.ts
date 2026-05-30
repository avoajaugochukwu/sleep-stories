import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { IMAGE_GENERATION_SUFFIX } from '@/lib/prompts/all-prompts';

// Grok Imagine has no negative_prompt param, so the key avoidances are folded
// into the prompt text instead.
const AVOID_CLAUSE =
  'Avoid: bright daylight, harsh or high-key lighting, text, captions, watermarks, logos, busy or cluttered compositions, and anything scary, jarring, or violent.';

interface FalImageResult {
  data?: {
    images: Array<{ url: string }>;
  };
  images?: Array<{ url: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json();
    const { scene } = requestData;

    if (!scene) {
      return NextResponse.json({ error: 'Scene data is required' }, { status: 400 });
    }

    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'FAL_API_KEY is not configured' }, { status: 500 });
    }

    // Configure Fal.ai client
    fal.config({
      credentials: apiKey,
    });

    // Build enhanced prompt with the Sleep Stories dark cinematic aesthetic
    const basePrompt =
      scene.visual_prompt || 'A calm, dark, dreamlike scene in deep shadow with soft muted light';

    // Inject the sleep style suffix + avoidances to enforce dark, calming visuals
    const styledPrompt = `${basePrompt}, ${IMAGE_GENERATION_SUFFIX}. ${AVOID_CLAUSE}`;

    console.log(`[Scene Image] Generating image for scene ${scene.scene_number}`);
    console.log(`[Scene Image] Prompt length: ${styledPrompt.length} characters`);

    // Grok Imagine Image (xAI) via fal, 16:9 at 2k for full-screen video backgrounds
    const apiEndpoint = 'xai/grok-imagine-image';
    const apiRequest = {
      input: {
        prompt: styledPrompt,
        num_images: 1,
        aspect_ratio: '16:9',
        resolution: '2k',
        output_format: 'jpeg',
      },
      logs: false,
    };

    const result = (await fal.subscribe(apiEndpoint, apiRequest)) as FalImageResult;

    // Extract image URL from response
    const imageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;

    if (!imageUrl) {
      throw new Error('No image URL in response');
    }

    console.log(`[Scene Image] Successfully generated image for scene ${scene.scene_number}`);

    return NextResponse.json({
      image_url: imageUrl,
      prompt_used: styledPrompt,
      aspect_ratio: '16:9',
      model: 'xai/grok-imagine-image',
      style: 'sleep-dark-cinematic',
    });
  } catch (error) {
    console.error('[Scene Image] Generation error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to generate scene image',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
